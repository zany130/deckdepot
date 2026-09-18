/** IEEE CRC32 used by the historical non-Steam shortcut AppID formula. */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

export function crc32String(value: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < value.length; i++) {
    crc = TABLE[(crc ^ value.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function historicalShortcutAppId(exe: string, name: string): number {
  return (crc32String(exe + name) | 0x80000000) >>> 0;
}

export function compareHistoricalIds(
  returnedAppId: number,
  exe: string,
  name: string
): Record<string, unknown> {
  const exeName = historicalShortcutAppId(exe, name);
  const quotedExeName = historicalShortcutAppId(`"${exe}"`, name);
  const nameExe = historicalShortcutAppId(name, exe);
  const exeOnly = (crc32String(exe) | 0x80000000) >>> 0;
  const variants: Record<string, number> = {
    exeConcatName: exeName,
    quotedExeConcatName: quotedExeName,
    nameConcatExe: nameExe,
    exeOnly,
  };
  const matches = Object.entries(variants)
    .filter(([, value]) => value === (returnedAppId >>> 0))
    .map(([key]) => key);
  return {
    returnedAppId: returnedAppId >>> 0,
    returnedUnsigned: returnedAppId >>> 0,
    gridId64: ((BigInt(returnedAppId >>> 0) << 32n) | 0x02000000n).toString(),
    variants,
    matchingVariants: matches,
    formulaNeeded: matches.length > 0 ? "formula matched at least one variant" : "no tested variant matched",
  };
}
