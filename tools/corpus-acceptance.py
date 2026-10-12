import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path


def analyze(report, root):
    path = Path(report['file'])
    packets = report['packets']
    generations = defaultdict(dict)
    generation = 0
    for packet in packets:
        if packet['syn'] and not packet['ackFlag']:
            generation += 1
        if packet.get('source'):
            key = (packet['source'], packet['destination'])
            stream = generations[generation].setdefault(key, {
                'base': None, 'bytes': {}, 'sources': defaultdict(list),
                'conflicts': set(), 'duplicates': [], 'reordered': [], 'max_seq': None,
                'truncated': [], 'checksum_uncertain': [],
            })
            if packet['syn']:
                stream['base'] = (packet['seq'] + 1) & 0xffffffff
            payload = bytes.fromhex(packet.get('payloadHex', ''))
            if not payload:
                continue
            seq = packet['seq']
            duplicate = all(stream['bytes'].get(seq + i) == byte for i, byte in enumerate(payload))
            if duplicate:
                stream['duplicates'].append(packet['packetNo'])
            elif stream['max_seq'] is not None and seq < stream['max_seq']:
                stream['reordered'].append(packet['packetNo'])
            stream['max_seq'] = max(seq, stream['max_seq'] or seq)
            if packet['capturedLength'] < packet['originalLength']:
                stream['truncated'].append(packet['packetNo'])
            if packet.get('checksum') == 'INVALID_OR_OFFLOAD':
                stream['checksum_uncertain'].append(packet['packetNo'])
            for i, byte in enumerate(payload):
                if seq + i in stream['bytes'] and stream['bytes'][seq + i] != byte:
                    stream['conflicts'].add(seq + i)
                stream['bytes'].setdefault(seq + i, byte)
                stream['sources'][seq + i].append({
                    'packetNo': packet['packetNo'],
                    'frameOffset': packet['payloadOffset'] + i,
                })
    streams = []
    for gen, flows in sorted(generations.items()):
        for (source, destination), stream in sorted(flows.items()):
            if not stream['bytes']:
                continue
            base = stream['base'] if stream['base'] is not None else min(stream['bytes'])
            end = max(stream['bytes']) + 1
            missing = [offset - base for offset in range(base, end) if offset not in stream['bytes']]
            conflicts = sorted(offset - base for offset in stream['conflicts'])
            trustworthy = stream['base'] is not None and not missing and not conflicts and not stream['truncated']
            messages = []
            if trustworthy:
                data = bytes(stream['bytes'][offset] for offset in range(base, end))
                position = 0
                while position < len(data):
                    if data[position:position+2] != b'\xa6\x5c' or len(data)-position < 8:
                        raise ValueError(f'{path}: framing failed at {position}')
                    length = int.from_bytes(data[position+2:position+4], 'big')
                    stop = position + 8 + length
                    if stop > len(data):
                        raise ValueError(f'{path}: incomplete frame at {position}')
                    messages.append({'offset': position, 'length': 8+length,
                                     'payloadLength': length, 'headerHex': data[position:position+8].hex()})
                    position = stop
                digest = hashlib.sha256(data).hexdigest()
            else:
                digest = None
            streams.append({
                'generation': gen, 'source': source, 'destination': destination,
                'knownStart': stream['base'] is not None,
                'structuralStatus': 'KNOWN_BYTES' if trustworthy else 'INCONCLUSIVE',
                'checksumPolicyStatus': 'NEEDS_CAPTURE_CONTEXT' if stream['checksum_uncertain'] else 'NO_MISMATCH_OBSERVED',
                'knownBytes': len(stream['bytes']), 'logicalLength': end-base,
                'missingOffsets': missing, 'conflictOffsets': conflicts,
                'duplicatePackets': stream['duplicates'], 'reorderedPackets': stream['reordered'],
                'truncatedPackets': stream['truncated'], 'checksumUncertainPackets': stream['checksum_uncertain'],
                'streamSHA256': digest, 'messageCount': len(messages) if trustworthy else None,
                'firstMessages': messages[:2],
                'firstLengthFieldSources': [stream['sources'].get(base+i, []) for i in (2, 3)] if trustworthy else [],
            })
    return {
        'file': path.relative_to(root).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'packetCount': len(packets), 'connectionStarts': [p['packetNo'] for p in packets if p['syn'] and not p['ackFlag']],
        'truncatedPackets': [p['packetNo'] for p in packets if p['capturedLength'] < p['originalLength']],
        'checksumUncertainPackets': [p['packetNo'] for p in packets if p.get('checksum') == 'INVALID_OR_OFFLOAD'],
        'streams': streams,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', default='docs/corpus-inspection.json')
    parser.add_argument('--root', default='testdata/sample_protocol')
    parser.add_argument('--out', default='testdata/acceptance/day1.json')
    args = parser.parse_args()
    reports = json.loads(Path(args.input).read_text(encoding='utf-8'))
    result = {
        'probeScope': 'Provided fixtures only; one IPv4 TCP flow per capture, no sequence wrap; not the production reassembler.',
        'framingCandidate': {'magicHex': 'a65c', 'headerLength': 8, 'lengthOffset': 2,
                             'lengthWidth': 2, 'endian': 'big', 'totalLength': '8 + payloadLength',
                             'onIncompleteOrConflict': 'INCONCLUSIVE; no zero filling or magic resynchronization'},
        'captures': [analyze(report, Path(args.root)) for report in reports],
    }
    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes((json.dumps(result, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))


if __name__ == '__main__':
    main()
