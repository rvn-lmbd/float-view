import egm96GridUrl from '../assets/egm96-15.pgm?url';

/** GeographicLib's 15-minute EGM96 grid: https://geographiclib.sourceforge.io/C++/doc/geoid.html */
export interface GeoidGrid {
  undulation(latitude: number, longitude: number): number;
}

export function parseGeoidGrid(buffer: ArrayBuffer): GeoidGrid {
  const bytes = new Uint8Array(buffer);
  let position = 0;
  let offset: number | undefined;
  let scale: number | undefined;

  const isWhitespace = (value: number) => value === 9 || value === 10 || value === 13 || value === 32;
  const readToken = (): string => {
    while (position < bytes.length) {
      if (isWhitespace(bytes[position]!)) {
        position++;
      } else if (bytes[position] === 35) {
        const start = ++position;
        while (position < bytes.length && bytes[position] !== 10) position++;
        const comment = new TextDecoder().decode(bytes.subarray(start, position)).trim();
        if (comment.startsWith('Offset ')) offset = Number(comment.slice(7));
        if (comment.startsWith('Scale ')) scale = Number(comment.slice(6));
      } else {
        break;
      }
    }
    const start = position;
    while (position < bytes.length && !isWhitespace(bytes[position]!)) position++;
    return new TextDecoder().decode(bytes.subarray(start, position));
  };

  const magic = readToken();
  const width = Number(readToken());
  const height = Number(readToken());
  const maxValue = Number(readToken());
  if (magic !== 'P5' || width !== 1440 || height !== 721 || maxValue !== 65535) {
    throw new Error('Unsupported EGM96 geoid grid');
  }

  // The PGM binary data starts immediately after the whitespace following maxValue.
  if (!isWhitespace(bytes[position]!)) throw new Error('Invalid EGM96 geoid grid header');
  position++;
  if (bytes[position - 1] === 13 && bytes[position] === 10) position++;
  if (!Number.isFinite(offset) || !Number.isFinite(scale) || bytes.length - position !== width * height * 2) {
    throw new Error('Incomplete EGM96 geoid grid');
  }

  const dataOffset = position;
  const sample = (row: number, column: number): number => {
    const index = dataOffset + (row * width + column) * 2;
    return bytes[index]! * 256 + bytes[index + 1]!;
  };

  return {
    undulation(latitude, longitude) {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90) {
        throw new Error('Invalid GPS coordinates for geoid correction');
      }
      const x = (((longitude % 360) + 360) % 360) * (width / 360);
      const y = (90 - latitude) * ((height - 1) / 180);
      const west = Math.floor(x) % width;
      const east = (west + 1) % width;
      const north = Math.min(Math.floor(y), height - 2);
      const south = north + 1;
      const dx = x - Math.floor(x);
      const dy = y - north;
      const top = sample(north, west) * (1 - dx) + sample(north, east) * dx;
      const bottom = sample(south, west) * (1 - dx) + sample(south, east) * dx;
      return offset! + scale! * (top * (1 - dy) + bottom * dy);
    },
  };
}

let gridPromise: Promise<GeoidGrid> | undefined;

export function loadGeoidGrid(): Promise<GeoidGrid> {
  gridPromise ??= fetch(egm96GridUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load EGM96 geoid grid (${response.status})`);
      return response.arrayBuffer();
    })
    .then(parseGeoidGrid)
    .catch((error) => {
      gridPromise = undefined;
      throw error;
    });
  return gridPromise;
}

