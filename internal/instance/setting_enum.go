package instance

// enumSetting is one enum-valued setting: its stored values and the proto
// values they travel as, from one table.
type enumSetting[Stored ~string, Wire ~int32] struct {
	wire    map[Stored]Wire
	stored  map[Wire]Stored
	unknown Wire // what a stored value outside the table reads as
}

func newEnumSetting[Stored ~string, Wire ~int32](table map[Stored]Wire, unknown Wire) enumSetting[Stored, Wire] {
	stored := make(map[Wire]Stored, len(table))
	for value, wire := range table {
		stored[wire] = value
	}
	return enumSetting[Stored, Wire]{wire: table, stored: stored, unknown: unknown}
}

func (setting enumSetting[Stored, Wire]) toProto(value Stored) Wire {
	if wire, ok := setting.wire[value]; ok {
		return wire
	}
	return setting.unknown
}

func (setting enumSetting[Stored, Wire]) fromProto(wire Wire) (Stored, bool) {
	value, ok := setting.stored[wire]
	return value, ok
}

func (setting enumSetting[Stored, Wire]) has(value Stored) bool {
	_, ok := setting.wire[value]
	return ok
}
