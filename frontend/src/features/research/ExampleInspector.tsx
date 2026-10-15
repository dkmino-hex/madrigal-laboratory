import { Link } from 'react-router-dom';
import type { ResearchCandidate, ResearchRow } from '../../shared/api/contracts/research';
import { researchBytes, candidateValue } from '../../shared/model/research';
import { actionLabel, candidateLocation, displayResearchValue, exampleStatus, exampleTime, fieldHex, parameterInfo, readingDescription } from '../../shared/model/research-presentation';
import { sourceLink } from '../../shared/model/navigation';
import { ReadingPreview } from './ReadingPreview';

export function ExampleInspector({row,candidate,returnTo,onFocusField}:{row:ResearchRow;candidate:ResearchCandidate;returnTo:string;onFocusField:()=>void}) {
  const bytes=researchBytes(row), parameter=parameterInfo(candidate.parameter);
  const value=candidate.kind==='parameter' ? displayResearchValue(candidateValue(bytes,candidate),candidate.parameter) : fieldHex(row,candidate);
  const expected=row.values[candidate.parameter]===undefined ? null : displayResearchValue(row.values[candidate.parameter],candidate.parameter);
  const start=candidate.offset,end=Math.min(bytes.length,start+candidate.length);
  const packets=[...new Set(row.sources.map(source=>source.packetNo))];
  return <section className="panel research-inspector" aria-label="Разбор выбранного примера">
    <div className="panel-heading"><h2>Выбранный пример</h2><span className="research-status" data-status={exampleStatus(row,candidate)==='Совпало'?'match':exampleStatus(row,candidate)==='Отличается'?'counterexample':'unknown'}>{exampleStatus(row,candidate)}</span></div>
    <strong>{actionLabel(row.label)}</strong>
    <p className="muted">{row.captureName}<br/><time title={row.timestamp}>{exampleTime(row.timestamp)}</time> · {row.location.direction.replaceAll('_TO_',' → ')}</p>
    {row.association==='overlapping-windows' && <p className="research-notice">В этом окне несколько действий. Сопоставление доступно только для значений, в которых журнал не противоречит сам себе.</p>}
    <button className="research-field-selection" type="button" onClick={onFocusField}>
      <span>{candidate.kind==='parameter'?parameter.title:'Выделенный участок'} <small>название по журналу / предположение</small></span>
      <strong>{value}</strong>
    </button>
    <ReadingPreview hex={fieldHex(row,candidate)} value={value} expected={expected} reading={readingDescription(candidate)}/>
    <div className="research-packet-diagram" role="img" aria-label={`Расположение поля: ${candidate.length} байт с позиции ${start} от начала ${row.boundary==='tcp-fragment'?'TCP-фрагмента':'предполагаемого сообщения'}`}>
      {start>0&&<span style={{flex:Math.max(1,start)}}>До поля<br/>{start} Б</span>}
      <span className="research-diagram-field" style={{flex:Math.max(2,candidate.length)}}>Выбранное поле<br/>{candidate.length} Б</span>
      {bytes.length>end&&<span style={{flex:Math.max(1,bytes.length-end)}}>После поля<br/>{bytes.length-end} Б</span>}
    </div>
    <p className="muted">Положение от начала {row.boundary==='tcp-fragment'?'TCP-фрагмента':'сообщения'}: {candidate.offset}–{candidate.offset+candidate.length-1}. Отсчёт с нуля.</p>
    <details className="research-message-bytes"><summary>Байты этого примера · {bytes.length} Б</summary>
      <div className="research-message-hex" aria-label="Байты выбранного примера">
        {bytes.map((byte,index)=><span key={index} data-field={index>=start&&index<start+candidate.length} title={`Позиция ${index} (0x${index.toString(16).toUpperCase()})`}>{byte.toString(16).padStart(2,'0').toUpperCase()}</span>)}
      </div>
    </details>
    <Link className="button secondary" to={sourceLink(candidateLocation(row,candidate),{returnTo})}>Открыть исходные пакеты →</Link>
    <details className="research-technical"><summary>Координаты и технический путь</summary>
      <dl className="metadata"><div><dt>Параметр журнала</dt><dd><code>{candidate.parameter||'Не установлен'}</code></dd></div><div><dt>Чтение</dt><dd><code>{candidate.encoding}{candidate.divisor===1?'':' ÷ '+candidate.divisor}</code></dd></div><div><dt>Исходные пакеты сообщения</dt><dd>{packets.join(', ')}</dd></div><div><dt>Начало сообщения в потоке</dt><dd>{row.location.start}</dd></div><div><dt>Начало поля в потоке</dt><dd>{BigInt(row.location.start)+BigInt(candidate.offset)}</dd></div></dl>
      <p>Это восстановленный направленный поток. Граница TCP-пакета не устанавливает границу сообщения. {row.boundary==='tcp-fragment'?'Границы прикладного сообщения здесь ещё не определены.':'Границы сообщения предложены алгоритмом и требуют проверки.'}</p>
    </details>
  </section>;
}
