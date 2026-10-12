-- Interface metadata defines interpretation of the original timestamp ticks.
CREATE TRIGGER capture_interfaces_no_update BEFORE UPDATE ON capture_interfaces
BEGIN SELECT RAISE(ABORT, 'capture interfaces are immutable'); END;
CREATE TRIGGER capture_interfaces_no_delete BEFORE DELETE ON capture_interfaces
BEGIN SELECT RAISE(ABORT, 'capture interfaces are immutable'); END;
CREATE TRIGGER capture_interfaces_importing_insert BEFORE INSERT ON capture_interfaces
WHEN (SELECT status FROM captures WHERE id=NEW.capture_id) != 'IMPORTING'
BEGIN SELECT RAISE(ABORT, 'interfaces can only be added while importing'); END;
CREATE TRIGGER packets_importing_insert BEFORE INSERT ON packets
WHEN (SELECT status FROM captures WHERE id=NEW.capture_id) != 'IMPORTING'
BEGIN SELECT RAISE(ABORT, 'packets can only be added while importing'); END;

CREATE TRIGGER captures_ready_count BEFORE UPDATE ON captures WHEN NEW.status = 'READY'
BEGIN
    SELECT CASE WHEN NEW.packet_count != (SELECT count(*) FROM packets WHERE capture_id=NEW.id)
        OR NEW.packet_count != coalesce((SELECT max(packet_no) FROM packets WHERE capture_id=NEW.id),0)
        THEN RAISE(ABORT, 'ready capture requires a complete packet index numbered from one') END;
END;
CREATE TRIGGER captures_ready_insert BEFORE INSERT ON captures WHEN NEW.status = 'READY'
BEGIN SELECT RAISE(ABORT, 'create capture as IMPORTING, then publish the packet index'); END;
CREATE TRIGGER captures_ready_no_update BEFORE UPDATE ON captures WHEN OLD.status = 'READY'
BEGIN SELECT RAISE(ABORT, 'ready captures are immutable'); END;
CREATE TRIGGER captures_ready_no_delete BEFORE DELETE ON captures WHEN OLD.status = 'READY'
BEGIN SELECT RAISE(ABORT, 'ready captures are immutable'); END;

