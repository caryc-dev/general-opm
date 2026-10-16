/* hyparquet 1.31.2 (MIT, Hyperparam) + fzstd 0.1.1 (MIT, Arjun Barrett), bundled for the Workforce Look-Up (D-054).
 * Built once with esbuild 0.25.10: esbuild entry.js --bundle --format=iife --global-name=OPMParquet --target=es2019 --legal-comments=inline
 * where entry.js exports { parquetReadObjects, parquetMetadata } from hyparquet and compressors = { ZSTD } using fzstd.decompress.
 * Global: OPMParquet. Licenses: hyparquet-bundle.LICENSE.txt. No CDN; do not edit by hand. */
var OPMParquet = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // entry.js
  var entry_exports = {};
  __export(entry_exports, {
    compressors: () => compressors,
    parquetMetadata: () => parquetMetadata,
    parquetReadObjects: () => parquetReadObjects
  });

  // node_modules/hyparquet/src/constants.js
  var ParquetTypes = [
    "BOOLEAN",
    "INT32",
    "INT64",
    "INT96",
    // deprecated
    "FLOAT",
    "DOUBLE",
    "BYTE_ARRAY",
    "FIXED_LEN_BYTE_ARRAY"
  ];
  var Encodings = [
    "PLAIN",
    "GROUP_VAR_INT",
    // deprecated
    "PLAIN_DICTIONARY",
    "RLE",
    "BIT_PACKED",
    // deprecated
    "DELTA_BINARY_PACKED",
    "DELTA_LENGTH_BYTE_ARRAY",
    "DELTA_BYTE_ARRAY",
    "RLE_DICTIONARY",
    "BYTE_STREAM_SPLIT"
  ];
  var FieldRepetitionTypes = [
    "REQUIRED",
    "OPTIONAL",
    "REPEATED"
  ];
  var ConvertedTypes = [
    "UTF8",
    "MAP",
    "MAP_KEY_VALUE",
    "LIST",
    "ENUM",
    "DECIMAL",
    "DATE",
    "TIME_MILLIS",
    "TIME_MICROS",
    "TIMESTAMP_MILLIS",
    "TIMESTAMP_MICROS",
    "UINT_8",
    "UINT_16",
    "UINT_32",
    "UINT_64",
    "INT_8",
    "INT_16",
    "INT_32",
    "INT_64",
    "JSON",
    "BSON",
    "INTERVAL"
  ];
  var CompressionCodecs = [
    "UNCOMPRESSED",
    "SNAPPY",
    "GZIP",
    "LZO",
    "BROTLI",
    "LZ4",
    "ZSTD",
    "LZ4_RAW"
  ];
  var PageTypes = [
    "DATA_PAGE",
    "INDEX_PAGE",
    "DICTIONARY_PAGE",
    "DATA_PAGE_V2"
  ];
  var BoundaryOrders = [
    "UNORDERED",
    "ASCENDING",
    "DESCENDING"
  ];
  var EdgeInterpolationAlgorithms = [
    "SPHERICAL",
    "VINCENTY",
    "THOMAS",
    "ANDOYER",
    "KARNEY"
  ];

  // node_modules/hyparquet/src/wkb.js
  function wkbToGeojson(reader) {
    const flags = getFlags(reader);
    if (flags.type === 1) {
      return { type: "Point", coordinates: readPosition(reader, flags) };
    } else if (flags.type === 2) {
      return { type: "LineString", coordinates: readLine(reader, flags) };
    } else if (flags.type === 3) {
      return { type: "Polygon", coordinates: readPolygon(reader, flags) };
    } else if (flags.type === 4) {
      const points = [];
      for (let i = 0; i < flags.count; i++) {
        points.push(readPosition(reader, getFlags(reader)));
      }
      return { type: "MultiPoint", coordinates: points };
    } else if (flags.type === 5) {
      const lines = [];
      for (let i = 0; i < flags.count; i++) {
        lines.push(readLine(reader, getFlags(reader)));
      }
      return { type: "MultiLineString", coordinates: lines };
    } else if (flags.type === 6) {
      const polygons = [];
      for (let i = 0; i < flags.count; i++) {
        polygons.push(readPolygon(reader, getFlags(reader)));
      }
      return { type: "MultiPolygon", coordinates: polygons };
    } else if (flags.type === 7) {
      const geometries = [];
      for (let i = 0; i < flags.count; i++) {
        geometries.push(wkbToGeojson(reader));
      }
      return { type: "GeometryCollection", geometries };
    } else {
      throw new Error(`Unsupported geometry type: ${flags.type}`);
    }
  }
  function getFlags(reader) {
    const { view } = reader;
    const littleEndian = view.getUint8(reader.offset++) === 1;
    const rawType = view.getUint32(reader.offset, littleEndian);
    reader.offset += 4;
    const type = rawType % 1e3;
    const flags = Math.floor(rawType / 1e3);
    let count = 0;
    if (type > 1 && type <= 7) {
      count = view.getUint32(reader.offset, littleEndian);
      reader.offset += 4;
    }
    let dim = 2;
    if (flags) dim++;
    if (flags === 3) dim++;
    return { littleEndian, type, dim, count };
  }
  function readPosition(reader, flags) {
    const points = [];
    for (let i = 0; i < flags.dim; i++) {
      const coord = reader.view.getFloat64(reader.offset, flags.littleEndian);
      reader.offset += 8;
      points.push(coord);
    }
    return points;
  }
  function readLine(reader, flags) {
    const points = [];
    for (let i = 0; i < flags.count; i++) {
      points.push(readPosition(reader, flags));
    }
    return points;
  }
  function readPolygon(reader, flags) {
    const { view } = reader;
    const rings = [];
    for (let r = 0; r < flags.count; r++) {
      const count = view.getUint32(reader.offset, flags.littleEndian);
      reader.offset += 4;
      rings.push(readLine(reader, { ...flags, count }));
    }
    return rings;
  }

  // node_modules/hyparquet/src/convert.js
  var decoder = new TextDecoder();
  var DEFAULT_PARSERS = {
    timestampFromMilliseconds(millis) {
      return new Date(Number(millis));
    },
    timestampFromMicroseconds(micros) {
      return new Date(Number(micros / /* @__PURE__ */ BigInt("1000")));
    },
    timestampFromNanoseconds(nanos) {
      return new Date(Number(nanos / /* @__PURE__ */ BigInt("1000000")));
    },
    dateFromDays(days) {
      return new Date(days * 864e5);
    },
    stringFromBytes(bytes) {
      return bytes && decoder.decode(bytes);
    },
    jsonFromBytes(bytes) {
      return bytes && JSON.parse(decoder.decode(bytes));
    },
    geometryFromBytes(bytes) {
      return bytes && wkbToGeojson({ view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 });
    },
    geographyFromBytes(bytes) {
      return bytes && wkbToGeojson({ view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 });
    },
    uuidFromBytes(bytes) {
      if (!bytes) return void 0;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20, 32);
    }
  };
  function convertWithDictionary(data, dictionary, encoding, columnDecoder) {
    if (dictionary && encoding.endsWith("_DICTIONARY")) {
      let output = data;
      if (data instanceof Uint8Array && !(dictionary instanceof Uint8Array)) {
        output = new dictionary.constructor(data.length);
      }
      for (let i = 0; i < data.length; i++) {
        output[i] = dictionary[data[i]];
      }
      return output;
    } else {
      return convert(data, columnDecoder);
    }
  }
  function convert(data, columnDecoder) {
    const { element, parsers, utf8 = true, schemaPath } = columnDecoder;
    const { type, converted_type: ctype, logical_type: ltype } = element;
    const nullable = element.repetition_type !== "REQUIRED";
    const isVariant = schemaPath == null ? void 0 : schemaPath.some((s) => {
      var _a;
      return ((_a = s.element.logical_type) == null ? void 0 : _a.type) === "VARIANT";
    });
    if (isVariant && type === "BYTE_ARRAY" && ctype !== "UTF8" && (ltype == null ? void 0 : ltype.type) !== "STRING") {
      return data;
    }
    if (ctype === "DECIMAL") {
      const scale = element.scale || 0;
      const factor = 10 ** -scale;
      const arr = new Array(data.length);
      for (let i = 0; i < arr.length; i++) {
        if (data[i] instanceof Uint8Array) {
          arr[i] = parseDecimal(data[i]) * factor;
        } else {
          arr[i] = Number(data[i]) * factor;
        }
      }
      return arr;
    }
    if (!ctype && type === "INT96") {
      return Array.from(data).map((v) => parsers.timestampFromNanoseconds(parseInt96Nanos(v)));
    }
    if (ctype === "DATE") {
      return Array.from(data).map((v) => parsers.dateFromDays(v));
    }
    if (ctype === "TIMESTAMP_MILLIS") {
      return Array.from(data).map((v) => parsers.timestampFromMilliseconds(v));
    }
    if (ctype === "TIMESTAMP_MICROS") {
      return Array.from(data).map((v) => parsers.timestampFromMicroseconds(v));
    }
    if (ctype === "JSON") {
      return data.map((v) => parsers.jsonFromBytes(v));
    }
    if (ctype === "BSON") {
      throw new Error("parquet bson not supported");
    }
    if (ctype === "INTERVAL") {
      throw new Error("parquet interval not supported");
    }
    if ((ltype == null ? void 0 : ltype.type) === "GEOMETRY") {
      return data.map((v) => parsers.geometryFromBytes(v));
    }
    if ((ltype == null ? void 0 : ltype.type) === "GEOGRAPHY") {
      return data.map((v) => parsers.geographyFromBytes(v));
    }
    if ((ltype == null ? void 0 : ltype.type) === "UUID") {
      return data.map((v) => parsers.uuidFromBytes(v));
    }
    if (ctype === "UTF8" || (ltype == null ? void 0 : ltype.type) === "STRING" || utf8 && type === "BYTE_ARRAY") {
      return data.map((v) => parsers.stringFromBytes(v));
    }
    if (ctype === "UINT_64" || (ltype == null ? void 0 : ltype.type) === "INTEGER" && ltype.bitWidth === 64 && !ltype.isSigned) {
      if (data instanceof BigInt64Array) return new BigUint64Array(data.buffer, data.byteOffset, data.length);
      const arr = nullable ? new Array(data.length) : new BigUint64Array(data.length);
      for (let i = 0; i < arr.length; i++) arr[i] = data[i];
      return arr;
    }
    if (ctype === "UINT_32" || (ltype == null ? void 0 : ltype.type) === "INTEGER" && ltype.bitWidth === 32 && !ltype.isSigned) {
      if (data instanceof Int32Array) return new Uint32Array(data.buffer, data.byteOffset, data.length);
      const arr = nullable ? new Array(data.length) : new Uint32Array(data.length);
      for (let i = 0; i < arr.length; i++) {
        arr[i] = data[i] < 0 ? 4294967296 + data[i] : data[i];
      }
      return arr;
    }
    if ((ltype == null ? void 0 : ltype.type) === "FLOAT16") {
      return Array.from(data).map(parseFloat16);
    }
    if ((ltype == null ? void 0 : ltype.type) === "TIMESTAMP") {
      const { unit } = ltype;
      let parser = parsers.timestampFromMilliseconds;
      if (unit === "MICROS") parser = parsers.timestampFromMicroseconds;
      if (unit === "NANOS") parser = parsers.timestampFromNanoseconds;
      const arr = new Array(data.length);
      for (let i = 0; i < arr.length; i++) {
        arr[i] = parser(data[i]);
      }
      return arr;
    }
    return data;
  }
  function parseDecimal(bytes) {
    if (!bytes.length) return 0;
    let value = /* @__PURE__ */ BigInt("0");
    for (const byte of bytes) {
      value = value * /* @__PURE__ */ BigInt("256") + BigInt(byte);
    }
    const bits = bytes.length * 8;
    if (value >= /* @__PURE__ */ BigInt("2") ** BigInt(bits - 1)) {
      value -= /* @__PURE__ */ BigInt("2") ** BigInt(bits);
    }
    return Number(value);
  }
  function parseInt96Nanos(value) {
    const days = (value >> /* @__PURE__ */ BigInt("64")) - /* @__PURE__ */ BigInt("2440588");
    const nano = value & /* @__PURE__ */ BigInt("0xffffffffffffffff");
    return days * /* @__PURE__ */ BigInt("86400000000000") + nano;
  }
  function parseFloat16(bytes) {
    if (!bytes) return void 0;
    const int16 = bytes[1] << 8 | bytes[0];
    const sign = int16 >> 15 ? -1 : 1;
    const exp = int16 >> 10 & 31;
    const frac = int16 & 1023;
    if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
    if (exp === 31) return frac ? NaN : sign * Infinity;
    return sign * 2 ** (exp - 15) * (1 + frac / 1024);
  }

  // node_modules/hyparquet/src/schema.js
  function schemaTree(schema, rootIndex, path) {
    const element = schema[rootIndex];
    const children = [];
    let count = 1;
    if (element.num_children) {
      while (children.length < element.num_children) {
        const childElement = schema[rootIndex + count];
        const child = schemaTree(schema, rootIndex + count, [...path, childElement.name]);
        count += child.count;
        children.push(child);
      }
    }
    return { count, element, children, path };
  }
  function getSchemaPath(schema, name) {
    let tree = schemaTree(schema, 0, []);
    const path = [tree];
    for (const part of name) {
      const child = tree.children.find((child2) => child2.element.name === part);
      if (!child) throw new Error(`parquet schema element not found: ${name}`);
      path.push(child);
      tree = child;
    }
    return path;
  }
  function getPhysicalColumns(schemaTree2) {
    const columns = [];
    function traverse(node) {
      if (node.children.length) {
        for (const child of node.children) {
          traverse(child);
        }
      } else {
        columns.push(node.path.join("."));
      }
    }
    traverse(schemaTree2);
    return columns;
  }
  function getMaxRepetitionLevel(schemaPath) {
    let maxLevel = 0;
    for (const { element } of schemaPath) {
      if (element.repetition_type === "REPEATED") {
        maxLevel++;
      }
    }
    return maxLevel;
  }
  function getMaxDefinitionLevel(schemaPath) {
    let maxLevel = 0;
    for (const { element } of schemaPath.slice(1)) {
      if (element.repetition_type !== "REQUIRED") {
        maxLevel++;
      }
    }
    return maxLevel;
  }
  function isListLike(schema) {
    if (!schema) return false;
    if (schema.element.converted_type !== "LIST") return false;
    if (schema.children.length > 1) return false;
    const firstChild = schema.children[0];
    if (firstChild.children.length > 1) return false;
    if (firstChild.element.repetition_type !== "REPEATED") return false;
    return true;
  }
  function isMapLike(schema) {
    if (!schema) return false;
    if (schema.element.converted_type !== "MAP") return false;
    if (schema.children.length > 1) return false;
    const firstChild = schema.children[0];
    if (firstChild.children.length !== 2) return false;
    if (firstChild.element.repetition_type !== "REPEATED") return false;
    const keyChild = firstChild.children.find((child) => child.element.name === "key");
    if ((keyChild == null ? void 0 : keyChild.element.repetition_type) === "REPEATED") return false;
    const valueChild = firstChild.children.find((child) => child.element.name === "value");
    if ((valueChild == null ? void 0 : valueChild.element.repetition_type) === "REPEATED") return false;
    return true;
  }
  function isFlatColumn(schemaPath) {
    if (schemaPath.length !== 2) return false;
    const [, column] = schemaPath;
    if (column.element.repetition_type === "REPEATED") return false;
    if (column.children.length) return false;
    return true;
  }

  // node_modules/hyparquet/src/thrift.js
  var STOP = 0;
  var TRUE = 1;
  var FALSE = 2;
  var BYTE = 3;
  var I16 = 4;
  var I32 = 5;
  var I64 = 6;
  var DOUBLE = 7;
  var BINARY = 8;
  var LIST = 9;
  var STRUCT = 12;
  function deserializeTCompactProtocol(reader) {
    const value = {};
    let fid = 0;
    while (reader.offset < reader.view.byteLength) {
      const byte = reader.view.getUint8(reader.offset++);
      const type = byte & 15;
      if (type === STOP) break;
      const delta = byte >> 4;
      fid = delta ? fid + delta : readZigZag(reader);
      value[`field_${fid}`] = readElement(reader, type);
    }
    return value;
  }
  function readElement(reader, type) {
    switch (type) {
      case TRUE:
        return true;
      case FALSE:
        return false;
      case BYTE:
        return reader.view.getInt8(reader.offset++);
      case I16:
      case I32:
        return readZigZag(reader);
      case I64:
        return readZigZagBigInt(reader);
      case DOUBLE: {
        const value = reader.view.getFloat64(reader.offset, true);
        reader.offset += 8;
        return value;
      }
      case BINARY: {
        const stringLength = readVarInt(reader);
        const strBytes = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, stringLength);
        reader.offset += stringLength;
        return strBytes;
      }
      case LIST: {
        const byte = reader.view.getUint8(reader.offset++);
        const elemType = byte & 15;
        let listSize = byte >> 4;
        if (listSize === 15) {
          listSize = readVarInt(reader);
        }
        const boolType = elemType === TRUE || elemType === FALSE;
        const values = new Array(listSize);
        for (let i = 0; i < listSize; i++) {
          values[i] = boolType ? readElement(reader, BYTE) === 1 : readElement(reader, elemType);
        }
        return values;
      }
      case STRUCT:
        return deserializeTCompactProtocol(reader);
      default:
        throw new Error(`thrift unhandled type: ${type}`);
    }
  }
  function readVarInt(reader) {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = reader.view.getUint8(reader.offset++);
      result |= (byte & 127) << shift;
      if (!(byte & 128)) {
        return result;
      }
      shift += 7;
    }
  }
  function readVarBigInt(reader) {
    let result = /* @__PURE__ */ BigInt("0");
    let shift = /* @__PURE__ */ BigInt("0");
    while (true) {
      const byte = reader.view.getUint8(reader.offset++);
      result |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) {
        return result;
      }
      shift += /* @__PURE__ */ BigInt("7");
    }
  }
  function readZigZag(reader) {
    const zigzag = readVarInt(reader);
    return zigzag >>> 1 ^ -(zigzag & 1);
  }
  function readZigZagBigInt(reader) {
    const zigzag = readVarBigInt(reader);
    return zigzag >> /* @__PURE__ */ BigInt("1") ^ -(zigzag & /* @__PURE__ */ BigInt("1"));
  }

  // node_modules/hyparquet/src/geoparquet.js
  function markGeoColumns(schema, key_value_metadata) {
    var _a, _b, _c, _d, _e, _f, _g;
    const columns = /* @__PURE__ */ new Map();
    const geo = (_a = key_value_metadata == null ? void 0 : key_value_metadata.find(({ key }) => key === "geo")) == null ? void 0 : _a.value;
    const decodedColumns = (_c = geo && ((_b = JSON.parse(geo)) == null ? void 0 : _b.columns)) != null ? _c : {};
    for (const [name, column] of Object.entries(decodedColumns)) {
      if (column.encoding !== "WKB") continue;
      const type = column.edges === "spherical" ? "GEOGRAPHY" : "GEOMETRY";
      const id = (_g = (_d = column.crs) == null ? void 0 : _d.id) != null ? _g : (_f = (_e = column.crs) == null ? void 0 : _e.ids) == null ? void 0 : _f[0];
      const crs = id ? `${id.authority}:${id.code.toString()}` : void 0;
      columns.set(name, { type, crs });
    }
    for (let i = 1; i < schema.length; i++) {
      const { logical_type, name, num_children, type } = schema[i];
      if (num_children) {
        i += num_children;
        continue;
      }
      if (type === "BYTE_ARRAY" && !logical_type) {
        schema[i].logical_type = columns.get(name);
      }
    }
  }

  // node_modules/hyparquet/src/metadata.js
  var defaultInitialFetchSize = 1 << 19;
  var decoder2 = new TextDecoder();
  function decode(value) {
    return value && decoder2.decode(value);
  }
  async function parquetMetadataAsync(asyncBuffer, { parsers, initialFetchSize = defaultInitialFetchSize, geoparquet = true } = {}) {
    if (!asyncBuffer || !(asyncBuffer.byteLength >= 0)) throw new Error("parquet expected AsyncBuffer");
    const footerOffset = Math.max(0, asyncBuffer.byteLength - initialFetchSize);
    const footerBuffer = await asyncBuffer.slice(footerOffset, asyncBuffer.byteLength);
    const footerView = new DataView(footerBuffer);
    if (footerView.getUint32(footerBuffer.byteLength - 4, true) !== 827474256) {
      throw new Error("parquet file invalid (footer != PAR1)");
    }
    const metadataLength = footerView.getUint32(footerBuffer.byteLength - 8, true);
    if (metadataLength > asyncBuffer.byteLength - 8) {
      throw new Error(`parquet metadata length ${metadataLength} exceeds available buffer ${asyncBuffer.byteLength - 8}`);
    }
    if (metadataLength + 8 > initialFetchSize) {
      const metadataOffset = asyncBuffer.byteLength - metadataLength - 8;
      const metadataBuffer = await asyncBuffer.slice(metadataOffset, footerOffset);
      const combinedBuffer = new ArrayBuffer(metadataLength + 8);
      const combinedView = new Uint8Array(combinedBuffer);
      combinedView.set(new Uint8Array(metadataBuffer));
      combinedView.set(new Uint8Array(footerBuffer), footerOffset - metadataOffset);
      return parquetMetadata(combinedBuffer, { parsers, geoparquet });
    } else {
      return parquetMetadata(footerBuffer, { parsers, geoparquet });
    }
  }
  function parquetMetadata(arrayBuffer, { parsers, geoparquet = true } = {}) {
    var _a;
    if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error("parquet expected ArrayBuffer");
    const view = new DataView(arrayBuffer);
    const allParsers = { ...DEFAULT_PARSERS, ...parsers };
    if (view.byteLength < 8) {
      throw new Error("parquet file is too short");
    }
    if (view.getUint32(view.byteLength - 4, true) !== 827474256) {
      throw new Error("parquet file invalid (footer != PAR1)");
    }
    const metadataLengthOffset = view.byteLength - 8;
    const metadataLength = view.getUint32(metadataLengthOffset, true);
    if (metadataLength > view.byteLength - 8) {
      throw new Error(`parquet metadata length ${metadataLength} exceeds available buffer ${view.byteLength - 8}`);
    }
    const metadataOffset = metadataLengthOffset - metadataLength;
    const reader = { view, offset: metadataOffset };
    const metadata = deserializeTCompactProtocol(reader);
    const version = metadata.field_1;
    const schema = metadata.field_2.map((field) => ({
      type: ParquetTypes[field.field_1],
      type_length: field.field_2,
      repetition_type: FieldRepetitionTypes[field.field_3],
      name: decode(field.field_4),
      num_children: field.field_5,
      converted_type: ConvertedTypes[field.field_6],
      scale: field.field_7,
      precision: field.field_8,
      field_id: field.field_9,
      logical_type: logicalType(field.field_10)
    }));
    const columnSchema = schema.filter((e) => e.type);
    const num_rows = metadata.field_3;
    const row_groups = metadata.field_4.map((rowGroup) => {
      var _a2;
      return {
        columns: rowGroup.field_1.map((column, columnIndex) => {
          var _a3, _b, _c;
          return {
            file_path: decode(column.field_1),
            file_offset: column.field_2,
            meta_data: column.field_3 && {
              type: ParquetTypes[column.field_3.field_1],
              encodings: (_a3 = column.field_3.field_2) == null ? void 0 : _a3.map((e) => Encodings[e]),
              path_in_schema: column.field_3.field_3.map(decode),
              codec: CompressionCodecs[column.field_3.field_4],
              num_values: column.field_3.field_5,
              total_uncompressed_size: column.field_3.field_6,
              total_compressed_size: column.field_3.field_7,
              key_value_metadata: (_b = column.field_3.field_8) == null ? void 0 : _b.map((kv) => ({
                key: decode(kv.field_1),
                value: decode(kv.field_2)
              })),
              data_page_offset: column.field_3.field_9,
              index_page_offset: column.field_3.field_10,
              dictionary_page_offset: column.field_3.field_11,
              statistics: convertStats(column.field_3.field_12, columnSchema[columnIndex], allParsers),
              encoding_stats: (_c = column.field_3.field_13) == null ? void 0 : _c.map((encodingStat) => ({
                page_type: PageTypes[encodingStat.field_1],
                encoding: Encodings[encodingStat.field_2],
                count: encodingStat.field_3
              })),
              bloom_filter_offset: column.field_3.field_14,
              bloom_filter_length: column.field_3.field_15,
              size_statistics: column.field_3.field_16 && {
                unencoded_byte_array_data_bytes: column.field_3.field_16.field_1,
                repetition_level_histogram: column.field_3.field_16.field_2,
                definition_level_histogram: column.field_3.field_16.field_3
              },
              geospatial_statistics: column.field_3.field_17 && {
                bbox: column.field_3.field_17.field_1 && {
                  xmin: column.field_3.field_17.field_1.field_1,
                  xmax: column.field_3.field_17.field_1.field_2,
                  ymin: column.field_3.field_17.field_1.field_3,
                  ymax: column.field_3.field_17.field_1.field_4,
                  zmin: column.field_3.field_17.field_1.field_5,
                  zmax: column.field_3.field_17.field_1.field_6,
                  mmin: column.field_3.field_17.field_1.field_7,
                  mmax: column.field_3.field_17.field_1.field_8
                },
                geospatial_types: column.field_3.field_17.field_2
              }
            },
            offset_index_offset: column.field_4,
            offset_index_length: column.field_5,
            column_index_offset: column.field_6,
            column_index_length: column.field_7,
            crypto_metadata: column.field_8,
            encrypted_column_metadata: column.field_9
          };
        }),
        total_byte_size: rowGroup.field_2,
        num_rows: rowGroup.field_3,
        sorting_columns: (_a2 = rowGroup.field_4) == null ? void 0 : _a2.map((sortingColumn) => ({
          column_idx: sortingColumn.field_1,
          descending: sortingColumn.field_2,
          nulls_first: sortingColumn.field_3
        })),
        file_offset: rowGroup.field_5,
        total_compressed_size: rowGroup.field_6,
        ordinal: rowGroup.field_7
      };
    });
    const key_value_metadata = (_a = metadata.field_5) == null ? void 0 : _a.map((kv) => ({
      key: decode(kv.field_1),
      value: decode(kv.field_2)
    }));
    const created_by = decode(metadata.field_6);
    if (geoparquet) {
      markGeoColumns(schema, key_value_metadata);
    }
    return {
      version,
      schema,
      num_rows,
      row_groups,
      key_value_metadata,
      created_by,
      metadata_length: metadataLength
    };
  }
  function parquetSchema({ schema }) {
    return getSchemaPath(schema, [])[0];
  }
  function logicalType(logicalType2) {
    if (logicalType2 == null ? void 0 : logicalType2.field_1) return { type: "STRING" };
    if (logicalType2 == null ? void 0 : logicalType2.field_2) return { type: "MAP" };
    if (logicalType2 == null ? void 0 : logicalType2.field_3) return { type: "LIST" };
    if (logicalType2 == null ? void 0 : logicalType2.field_4) return { type: "ENUM" };
    if (logicalType2 == null ? void 0 : logicalType2.field_5) return {
      type: "DECIMAL",
      scale: logicalType2.field_5.field_1,
      precision: logicalType2.field_5.field_2
    };
    if (logicalType2 == null ? void 0 : logicalType2.field_6) return { type: "DATE" };
    if (logicalType2 == null ? void 0 : logicalType2.field_7) return {
      type: "TIME",
      isAdjustedToUTC: logicalType2.field_7.field_1,
      unit: timeUnit(logicalType2.field_7.field_2)
    };
    if (logicalType2 == null ? void 0 : logicalType2.field_8) return {
      type: "TIMESTAMP",
      isAdjustedToUTC: logicalType2.field_8.field_1,
      unit: timeUnit(logicalType2.field_8.field_2)
    };
    if (logicalType2 == null ? void 0 : logicalType2.field_10) return {
      type: "INTEGER",
      bitWidth: logicalType2.field_10.field_1,
      isSigned: logicalType2.field_10.field_2
    };
    if (logicalType2 == null ? void 0 : logicalType2.field_11) return { type: "NULL" };
    if (logicalType2 == null ? void 0 : logicalType2.field_12) return { type: "JSON" };
    if (logicalType2 == null ? void 0 : logicalType2.field_13) return { type: "BSON" };
    if (logicalType2 == null ? void 0 : logicalType2.field_14) return { type: "UUID" };
    if (logicalType2 == null ? void 0 : logicalType2.field_15) return { type: "FLOAT16" };
    if (logicalType2 == null ? void 0 : logicalType2.field_16) return {
      type: "VARIANT",
      specification_version: logicalType2.field_16.field_1
    };
    if (logicalType2 == null ? void 0 : logicalType2.field_17) return {
      type: "GEOMETRY",
      crs: decode(logicalType2.field_17.field_1)
    };
    if (logicalType2 == null ? void 0 : logicalType2.field_18) return {
      type: "GEOGRAPHY",
      crs: decode(logicalType2.field_18.field_1),
      algorithm: EdgeInterpolationAlgorithms[logicalType2.field_18.field_2]
    };
    return logicalType2;
  }
  function timeUnit(unit) {
    if (unit.field_1) return "MILLIS";
    if (unit.field_2) return "MICROS";
    if (unit.field_3) return "NANOS";
    throw new Error("parquet time unit required");
  }
  function convertStats(stats, schema, parsers) {
    return stats && {
      max: convertMetadata(stats.field_1, schema, parsers),
      min: convertMetadata(stats.field_2, schema, parsers),
      null_count: stats.field_3,
      distinct_count: stats.field_4,
      max_value: convertMetadata(stats.field_5, schema, parsers),
      min_value: convertMetadata(stats.field_6, schema, parsers),
      is_max_value_exact: stats.field_7,
      is_min_value_exact: stats.field_8
    };
  }
  function convertMetadata(value, schema, parsers) {
    const { type, converted_type, logical_type } = schema;
    if (value === void 0) return value;
    if (type === "BOOLEAN") return value[0] === 1;
    if (type === "BYTE_ARRAY") return parsers.stringFromBytes(value);
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    if (type === "FLOAT" && view.byteLength === 4) return view.getFloat32(0, true);
    if (type === "DOUBLE" && view.byteLength === 8) return view.getFloat64(0, true);
    if (type === "INT32" && converted_type === "DECIMAL" && view.byteLength === 4) {
      return view.getInt32(0, true) * 10 ** -(schema.scale || 0);
    }
    if (type === "INT64" && converted_type === "DECIMAL" && view.byteLength === 8) {
      return Number(view.getBigInt64(0, true)) * 10 ** -(schema.scale || 0);
    }
    if (type === "INT32" && converted_type === "DATE") return parsers.dateFromDays(view.getInt32(0, true));
    if (type === "INT64" && converted_type === "TIMESTAMP_MILLIS") return parsers.timestampFromMilliseconds(view.getBigInt64(0, true));
    if (type === "INT64" && converted_type === "TIMESTAMP_MICROS") return parsers.timestampFromMicroseconds(view.getBigInt64(0, true));
    if (type === "INT64" && (logical_type == null ? void 0 : logical_type.type) === "TIMESTAMP" && (logical_type == null ? void 0 : logical_type.unit) === "NANOS") return parsers.timestampFromNanoseconds(view.getBigInt64(0, true));
    if (type === "INT64" && (logical_type == null ? void 0 : logical_type.type) === "TIMESTAMP" && (logical_type == null ? void 0 : logical_type.unit) === "MICROS") return parsers.timestampFromMicroseconds(view.getBigInt64(0, true));
    if (type === "INT64" && (logical_type == null ? void 0 : logical_type.type) === "TIMESTAMP") return parsers.timestampFromMilliseconds(view.getBigInt64(0, true));
    const unsigned = (converted_type == null ? void 0 : converted_type.startsWith("UINT_")) || (logical_type == null ? void 0 : logical_type.type) === "INTEGER" && !logical_type.isSigned;
    if (type === "INT32" && unsigned && view.byteLength === 4) return view.getUint32(0, true);
    if (type === "INT64" && unsigned && view.byteLength === 8) return view.getBigUint64(0, true);
    if (type === "INT32" && view.byteLength === 4) return view.getInt32(0, true);
    if (type === "INT64" && view.byteLength === 8) return view.getBigInt64(0, true);
    if (converted_type === "DECIMAL") return parseDecimal(value) * 10 ** -(schema.scale || 0);
    if ((logical_type == null ? void 0 : logical_type.type) === "FLOAT16") return parseFloat16(value);
    if ((logical_type == null ? void 0 : logical_type.type) === "UUID") return parsers.uuidFromBytes(value);
    if (type === "FIXED_LEN_BYTE_ARRAY") return value;
    return value;
  }

  // node_modules/hyparquet/src/indexes.js
  function readColumnIndex(reader, schema, parsers = void 0) {
    const allParsers = { ...DEFAULT_PARSERS, ...parsers };
    const thrift = deserializeTCompactProtocol(reader);
    return {
      null_pages: thrift.field_1,
      min_values: thrift.field_2.map((m) => convertMetadata(m, schema, allParsers)),
      max_values: thrift.field_3.map((m) => convertMetadata(m, schema, allParsers)),
      boundary_order: BoundaryOrders[thrift.field_4],
      null_counts: thrift.field_5,
      repetition_level_histograms: thrift.field_6,
      definition_level_histograms: thrift.field_7
    };
  }
  function readOffsetIndex(reader) {
    const thrift = deserializeTCompactProtocol(reader);
    return {
      // @ts-ignore
      page_locations: thrift.field_1.map((loc) => ({
        offset: loc.field_1,
        compressed_page_size: loc.field_2,
        first_row_index: loc.field_3
      })),
      unencoded_byte_array_data_bytes: thrift.field_2
    };
  }

  // node_modules/hyparquet/src/xxhash.js
  var MASK = /* @__PURE__ */ BigInt("0xffffffffffffffff");
  var PRIME1 = /* @__PURE__ */ BigInt("0x9e3779b185ebca87");
  var PRIME2 = /* @__PURE__ */ BigInt("0xc2b2ae3d27d4eb4f");
  var PRIME3 = /* @__PURE__ */ BigInt("0x165667b19e3779f9");
  var PRIME4 = /* @__PURE__ */ BigInt("0x85ebca77c2b2ae63");
  var PRIME5 = /* @__PURE__ */ BigInt("0x27d4eb2f165667c5");
  function rotl64(x, r) {
    return (x << r | x >> /* @__PURE__ */ BigInt("64") - r) & MASK;
  }
  function round(acc, val) {
    acc = acc + val * PRIME2 & MASK;
    acc = rotl64(acc, /* @__PURE__ */ BigInt("31"));
    return acc * PRIME1 & MASK;
  }
  function mergeRound(acc, val) {
    acc ^= round(/* @__PURE__ */ BigInt("0"), val);
    return acc * PRIME1 + PRIME4 & MASK;
  }
  function xxhash64(input, seed = /* @__PURE__ */ BigInt("0")) {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const len = input.byteLength;
    let offset = 0;
    let h64;
    if (len >= 32) {
      let v1 = seed + PRIME1 + PRIME2 & MASK;
      let v2 = seed + PRIME2 & MASK;
      let v3 = seed;
      let v4 = seed - PRIME1 & MASK;
      while (offset + 32 <= len) {
        v1 = round(v1, view.getBigUint64(offset, true));
        offset += 8;
        v2 = round(v2, view.getBigUint64(offset, true));
        offset += 8;
        v3 = round(v3, view.getBigUint64(offset, true));
        offset += 8;
        v4 = round(v4, view.getBigUint64(offset, true));
        offset += 8;
      }
      h64 = rotl64(v1, /* @__PURE__ */ BigInt("1")) + rotl64(v2, /* @__PURE__ */ BigInt("7")) + rotl64(v3, /* @__PURE__ */ BigInt("12")) + rotl64(v4, /* @__PURE__ */ BigInt("18")) & MASK;
      h64 = mergeRound(h64, v1);
      h64 = mergeRound(h64, v2);
      h64 = mergeRound(h64, v3);
      h64 = mergeRound(h64, v4);
    } else {
      h64 = seed + PRIME5 & MASK;
    }
    h64 = h64 + BigInt(len) & MASK;
    while (offset + 8 <= len) {
      h64 ^= round(/* @__PURE__ */ BigInt("0"), view.getBigUint64(offset, true));
      h64 = rotl64(h64, /* @__PURE__ */ BigInt("27")) * PRIME1 + PRIME4 & MASK;
      offset += 8;
    }
    if (offset + 4 <= len) {
      h64 ^= BigInt(view.getUint32(offset, true)) * PRIME1 & MASK;
      h64 = rotl64(h64, /* @__PURE__ */ BigInt("23")) * PRIME2 + PRIME3 & MASK;
      offset += 4;
    }
    while (offset < len) {
      h64 ^= BigInt(view.getUint8(offset)) * PRIME5 & MASK;
      h64 = rotl64(h64, /* @__PURE__ */ BigInt("11")) * PRIME1 & MASK;
      offset += 1;
    }
    h64 ^= h64 >> /* @__PURE__ */ BigInt("33");
    h64 = h64 * PRIME2 & MASK;
    h64 ^= h64 >> /* @__PURE__ */ BigInt("29");
    h64 = h64 * PRIME3 & MASK;
    h64 ^= h64 >> /* @__PURE__ */ BigInt("32");
    return h64;
  }

  // node_modules/hyparquet/src/bloom.js
  var textEncoder = new TextEncoder();
  var SALT = new Uint32Array([
    1203114875,
    1150766481,
    2284105051,
    2729912477,
    1884591559,
    770785867,
    2667333959,
    1550580529
  ]);
  function blockIndex(hash, numBlocks) {
    return Number((hash >> /* @__PURE__ */ BigInt("32")) * BigInt(numBlocks) >> /* @__PURE__ */ BigInt("32"));
  }
  function blockMask(hash) {
    const m = new Uint32Array(8);
    const low = Number(hash & /* @__PURE__ */ BigInt("0xffffffff")) | 0;
    for (let i = 0; i < 8; i++) {
      m[i] = 1 << (Math.imul(low, SALT[i]) >>> 27);
    }
    return m;
  }
  function sbbfContains(blocks, hash) {
    const offset = blockIndex(hash, blocks.length >> 3) << 3;
    const m = blockMask(hash);
    for (let i = 0; i < 8; i++) {
      if ((blocks[offset + i] & m[i]) === 0) return false;
    }
    return true;
  }
  function readBloomFilter(reader) {
    var _a, _b, _c;
    const header = deserializeTCompactProtocol(reader);
    const numBytes = header.field_1;
    if (typeof numBytes !== "number" || numBytes <= 0 || numBytes % 32 !== 0) return void 0;
    if (!((_a = header.field_2) == null ? void 0 : _a.field_1)) return void 0;
    if (!((_b = header.field_3) == null ? void 0 : _b.field_1)) return void 0;
    if (!((_c = header.field_4) == null ? void 0 : _c.field_1)) return void 0;
    const { view, offset } = reader;
    if (offset + numBytes > view.byteLength) {
      throw new Error(`parquet bloom filter truncated: need ${numBytes} bytes, have ${view.byteLength - offset}`);
    }
    const blocks = new Uint32Array(numBytes >> 2);
    for (let i = 0; i < blocks.length; i++) {
      blocks[i] = view.getUint32(offset + i * 4, true);
    }
    reader.offset = offset + numBytes;
    return { numBytes, blocks };
  }
  function hashParquetValue(value, element) {
    if (value === null || value === void 0) return void 0;
    const { type, converted_type, logical_type } = element;
    if (type === "BOOLEAN") {
      if (typeof value !== "boolean") return void 0;
      return xxhash64(new Uint8Array([value ? 1 : 0]));
    }
    if (type === "FLOAT") {
      if (typeof value !== "number") return void 0;
      const buf = new ArrayBuffer(4);
      new DataView(buf).setFloat32(0, value, true);
      return xxhash64(new Uint8Array(buf));
    }
    if (type === "DOUBLE") {
      if (typeof value !== "number") return void 0;
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, value, true);
      return xxhash64(new Uint8Array(buf));
    }
    if (type === "INT32") {
      if (converted_type === "DATE" || converted_type === "DECIMAL" || converted_type === "TIME_MILLIS") return void 0;
      if ((logical_type == null ? void 0 : logical_type.type) === "DATE" || (logical_type == null ? void 0 : logical_type.type) === "TIME" || (logical_type == null ? void 0 : logical_type.type) === "DECIMAL") return void 0;
      if (typeof value !== "number" || !Number.isInteger(value)) return void 0;
      const buf = new ArrayBuffer(4);
      new DataView(buf).setInt32(0, value | 0, true);
      return xxhash64(new Uint8Array(buf));
    }
    if (type === "INT64") {
      if (converted_type === "TIMESTAMP_MILLIS" || converted_type === "TIMESTAMP_MICROS") return void 0;
      if (converted_type === "TIME_MICROS" || converted_type === "DECIMAL") return void 0;
      if ((logical_type == null ? void 0 : logical_type.type) === "TIMESTAMP" || (logical_type == null ? void 0 : logical_type.type) === "TIME" || (logical_type == null ? void 0 : logical_type.type) === "DECIMAL") return void 0;
      let bigValue;
      if (typeof value === "bigint") bigValue = value;
      else if (typeof value === "number" && Number.isSafeInteger(value)) bigValue = BigInt(value);
      else return void 0;
      const buf = new ArrayBuffer(8);
      new DataView(buf).setBigUint64(0, BigInt.asUintN(64, bigValue), true);
      return xxhash64(new Uint8Array(buf));
    }
    if (type === "BYTE_ARRAY") {
      if (converted_type === "JSON" || converted_type === "BSON" || converted_type === "DECIMAL") return void 0;
      if ((logical_type == null ? void 0 : logical_type.type) === "JSON" || (logical_type == null ? void 0 : logical_type.type) === "BSON" || (logical_type == null ? void 0 : logical_type.type) === "VARIANT") return void 0;
      if ((logical_type == null ? void 0 : logical_type.type) === "GEOMETRY" || (logical_type == null ? void 0 : logical_type.type) === "GEOGRAPHY") return void 0;
      if (typeof value === "string") return xxhash64(textEncoder.encode(value));
      if (value instanceof Uint8Array) return xxhash64(value);
      return void 0;
    }
    if (type === "FIXED_LEN_BYTE_ARRAY") {
      if (converted_type === "DECIMAL" || converted_type === "INTERVAL") return void 0;
      if ((logical_type == null ? void 0 : logical_type.type) === "DECIMAL" || (logical_type == null ? void 0 : logical_type.type) === "UUID" || (logical_type == null ? void 0 : logical_type.type) === "FLOAT16") return void 0;
      if ((logical_type == null ? void 0 : logical_type.type) === "GEOMETRY" || (logical_type == null ? void 0 : logical_type.type) === "GEOGRAPHY") return void 0;
      if (value instanceof Uint8Array) return xxhash64(value);
      return void 0;
    }
    return void 0;
  }
  function bloomEligibleColumns(filter) {
    const out = /* @__PURE__ */ new Set();
    walkBloomEligible(filter, out);
    return out;
  }
  function walkBloomEligible(filter, out) {
    if (!filter) return;
    if ("$and" in filter && Array.isArray(filter.$and)) {
      for (const sub of filter.$and) walkBloomEligible(sub, out);
      return;
    }
    if ("$or" in filter && Array.isArray(filter.$or)) {
      for (const sub of filter.$or) walkBloomEligible(sub, out);
      return;
    }
    if ("$nor" in filter) return;
    for (const [field, condition] of Object.entries(filter)) {
      if (field.startsWith("$")) continue;
      if (typeof condition === "object" && condition !== null && !Array.isArray(condition)) {
        if ("$eq" in condition || "$in" in condition) out.add(field);
      } else {
        out.add(field);
      }
    }
  }

  // node_modules/hyparquet/src/utils.js
  function concat(aaa, bbb) {
    const chunk = 1e4;
    for (let i = 0; i < bbb.length; i += chunk) {
      aaa.push(...bbb.slice(i, i + chunk));
    }
  }
  function equals(a, b, strict = true) {
    if (strict ? a === b : a == b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (a instanceof Uint8Array && b instanceof Uint8Array) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }
    if (a instanceof Date || b instanceof Date) {
      return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!equals(a[i], b[i], strict)) return false;
      }
      return true;
    }
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const k of aKeys) {
      if (!equals(a[k], b[k], strict)) return false;
    }
    return true;
  }
  function flatten(chunks) {
    if (!chunks) return [];
    if (chunks.length === 1) return chunks[0];
    const output = [];
    for (const chunk of chunks) {
      concat(output, chunk);
    }
    return output;
  }

  // node_modules/hyparquet/src/filter.js
  var encoder = new TextEncoder();
  function pathsNeededForFilter(filter) {
    if (!filter) return [];
    const paths = [];
    if ("$and" in filter && Array.isArray(filter.$and)) {
      paths.push(...filter.$and.flatMap(pathsNeededForFilter));
    } else if ("$or" in filter && Array.isArray(filter.$or)) {
      paths.push(...filter.$or.flatMap(pathsNeededForFilter));
    } else if ("$nor" in filter && Array.isArray(filter.$nor)) {
      paths.push(...filter.$nor.flatMap(pathsNeededForFilter));
    } else {
      paths.push(...Object.keys(filter));
    }
    return [...new Set(paths)];
  }
  function columnsNeededForFilter(filter) {
    return [...new Set(pathsNeededForFilter(filter).map((path) => path.split(".")[0]))];
  }
  function matchFilter(record, filter, strict = true) {
    if ("$and" in filter && Array.isArray(filter.$and)) {
      return filter.$and.every((subQuery) => matchFilter(record, subQuery, strict));
    }
    if ("$or" in filter && Array.isArray(filter.$or)) {
      return filter.$or.some((subQuery) => matchFilter(record, subQuery, strict));
    }
    if ("$nor" in filter && Array.isArray(filter.$nor)) {
      return !filter.$nor.some((subQuery) => matchFilter(record, subQuery, strict));
    }
    return Object.entries(filter).every(([field, condition]) => {
      const value = resolve(record, field);
      if (typeof condition !== "object" || condition === null || Array.isArray(condition)) {
        return equals(value, condition, strict);
      }
      return Object.entries(condition || {}).every(([operator, target]) => {
        if (operator === "$gt") return value !== null && value !== void 0 && value > target;
        if (operator === "$gte") return value !== null && value !== void 0 && value >= target;
        if (operator === "$lt") return value !== null && value !== void 0 && value < target;
        if (operator === "$lte") return value !== null && value !== void 0 && value <= target;
        if (operator === "$eq") return equals(value, target, strict);
        if (operator === "$ne") return !equals(value, target, strict);
        if (operator === "$in") return Array.isArray(target) && matchesIn(value, target, strict);
        if (operator === "$nin") return Array.isArray(target) && !matchesIn(value, target, strict);
        if (operator === "$not") return !matchFilter({ value }, { value: target }, strict);
        return true;
      });
    });
  }
  function matchesIn(value, targets, strict) {
    return targets.some((target) => equals(value, target, strict) || Array.isArray(value) && value.some((element) => equals(element, target, strict)));
  }
  function canSkipRowGroup({ rowGroup, physicalColumns, filter, strict = true, bloomFilters, schemaElements }) {
    var _a;
    if (!filter) return false;
    if ("$and" in filter && Array.isArray(filter.$and)) {
      return filter.$and.some((subFilter) => canSkipRowGroup({ rowGroup, physicalColumns, filter: subFilter, strict, bloomFilters, schemaElements }));
    }
    if ("$or" in filter && Array.isArray(filter.$or)) {
      return filter.$or.every((subFilter) => canSkipRowGroup({ rowGroup, physicalColumns, filter: subFilter, strict, bloomFilters, schemaElements }));
    }
    if ("$nor" in filter && Array.isArray(filter.$nor)) {
      return false;
    }
    for (const [field, condition] of Object.entries(filter)) {
      const columnIndex = physicalColumns.indexOf(field);
      if (columnIndex === -1) continue;
      const stats = (_a = rowGroup.columns[columnIndex].meta_data) == null ? void 0 : _a.statistics;
      const { min, max, min_value, max_value, null_count: nullCount } = stats || {};
      const minVal = min_value !== void 0 ? min_value : min;
      const maxVal = max_value !== void 0 ? max_value : max;
      const haveStats = minVal !== void 0 && maxVal !== void 0;
      const bloom = bloomFilters == null ? void 0 : bloomFilters[field];
      const element = schemaElements == null ? void 0 : schemaElements[field];
      const matchingNulls = matchFilter({ value: null }, { value: condition }, strict) && (nullCount === void 0 || nullCount > 0);
      if (haveStats && !matchingNulls && canSkipStats(condition, minVal, maxVal, strict, element)) {
        return true;
      }
      for (const [operator, target] of Object.entries(condition || {})) {
        if (bloom && element) {
          if (operator === "$eq") {
            const hash = hashParquetValue(target, element);
            if (hash !== void 0 && !sbbfContains(bloom.blocks, hash)) return true;
          }
          if (operator === "$in" && Array.isArray(target) && target.length > 0) {
            let allAbsent = true;
            for (const v of target) {
              const h = hashParquetValue(v, element);
              if (h === void 0 || sbbfContains(bloom.blocks, h)) {
                allAbsent = false;
                break;
              }
            }
            if (allAbsent) return true;
          }
        }
      }
    }
    return false;
  }
  function canSkipStats(condition, minVal, maxVal, strict, element) {
    var _a;
    if (minVal === void 0 || maxVal === void 0) return false;
    const mayContainNaN = (element == null ? void 0 : element.type) === "FLOAT" || (element == null ? void 0 : element.type) === "DOUBLE" || ((_a = element == null ? void 0 : element.logical_type) == null ? void 0 : _a.type) === "FLOAT16";
    for (const [operator, target] of Object.entries(condition || {})) {
      const minComparison = compareParquetValues(minVal, target, strict, element);
      const maxComparison = compareParquetValues(maxVal, target, strict, element);
      const binaryBounds = minVal instanceof Uint8Array || maxVal instanceof Uint8Array;
      const relationalBoundsAreSafe = !binaryBounds && ((element == null ? void 0 : element.type) !== "BYTE_ARRAY" || typeof target === "string" && [...target].every((character) => character.charCodeAt(0) <= 127));
      if (operator === "$gt" && relationalBoundsAreSafe && maxComparison !== void 0 && maxComparison <= 0) return true;
      if (operator === "$gte" && relationalBoundsAreSafe && maxComparison !== void 0 && maxComparison < 0) return true;
      if (operator === "$lt" && relationalBoundsAreSafe && minComparison !== void 0 && minComparison >= 0) return true;
      if (operator === "$lte" && relationalBoundsAreSafe && minComparison !== void 0 && minComparison > 0) return true;
      if (operator === "$eq") {
        const targetMinComparison = compareParquetValues(target, minVal, strict, element);
        const targetMaxComparison = compareParquetValues(target, maxVal, strict, element);
        if (targetMinComparison !== void 0 && targetMinComparison < 0 || targetMaxComparison !== void 0 && targetMaxComparison > 0) return true;
      }
      if (operator === "$ne" && !mayContainNaN && equals(minVal, maxVal, strict) && equals(minVal, target, strict)) return true;
      if (operator === "$in" && Array.isArray(target) && target.every((value) => {
        const valueMinComparison = compareParquetValues(value, minVal, strict, element);
        const valueMaxComparison = compareParquetValues(value, maxVal, strict, element);
        return valueMinComparison !== void 0 && valueMinComparison < 0 || valueMaxComparison !== void 0 && valueMaxComparison > 0;
      })) return true;
      if (operator === "$nin" && !mayContainNaN && Array.isArray(target) && equals(minVal, maxVal, strict) && target.some((value) => equals(minVal, value, strict))) return true;
    }
    return false;
  }
  function compareParquetValues(a, b, strict, element) {
    if ((element == null ? void 0 : element.type) === "BYTE_ARRAY") {
      if (typeof a !== "string" || typeof b !== "string") return void 0;
      return compareBytes(encoder.encode(a), encoder.encode(b));
    }
    if (a instanceof Uint8Array || b instanceof Uint8Array) {
      if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return void 0;
      return compareBytes(a, b);
    }
    if (a < b) return -1;
    if (a > b) return 1;
    if (equals(a, b, strict)) return 0;
    return void 0;
  }
  function compareBytes(a, b) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    if (a.length < b.length) return -1;
    if (a.length > b.length) return 1;
    return 0;
  }
  function matchesNull(condition, strict) {
    return matchFilter({ value: null }, { value: condition }, strict);
  }
  function filterPageRanges(filter, columnPages, groupRows, strict = true) {
    var _a;
    if (!filter) return void 0;
    if ("$and" in filter && Array.isArray(filter.$and)) {
      let ranges;
      for (const subFilter of filter.$and) {
        ranges = intersectRanges(ranges, filterPageRanges(subFilter, columnPages, groupRows, strict));
      }
      return ranges;
    }
    if ("$or" in filter && Array.isArray(filter.$or)) {
      let ranges = [];
      for (const subFilter of filter.$or) {
        const subRanges = filterPageRanges(subFilter, columnPages, groupRows, strict);
        if (!subRanges) return void 0;
        ranges = unionRanges(ranges, subRanges);
      }
      return ranges;
    }
    if ("$nor" in filter && Array.isArray(filter.$nor)) {
      return void 0;
    }
    let result;
    for (const [field, condition] of Object.entries(filter)) {
      const pages = columnPages[field];
      if (!pages) continue;
      const nullCanMatch = matchesNull(condition, strict);
      const keep = [];
      for (let i = 0; i < pages.pageStarts.length; i++) {
        const start = pages.pageStarts[i];
        const end = i + 1 < pages.pageStarts.length ? pages.pageStarts[i + 1] : groupRows;
        const nullCount = (_a = pages.nullCounts) == null ? void 0 : _a[i];
        const matchingNulls = nullCanMatch && (nullCount === void 0 || nullCount > 0);
        const skip = !pages.nullPages[i] && !matchingNulls && canSkipStats(condition, pages.minValues[i], pages.maxValues[i], strict, pages.element);
        if (!skip) {
          const last = keep[keep.length - 1];
          if (last && last[1] === start) last[1] = end;
          else keep.push([start, end]);
        }
      }
      result = intersectRanges(result, keep);
    }
    return result;
  }
  function intersectRanges(a, b) {
    if (!a) return b;
    if (!b) return a;
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const start = Math.max(a[i][0], b[j][0]);
      const end = Math.min(a[i][1], b[j][1]);
      if (start < end) out.push([start, end]);
      if (a[i][1] < b[j][1]) i++;
      else j++;
    }
    return out;
  }
  function unionRanges(a, b) {
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      const next = j >= b.length || i < a.length && a[i][0] <= b[j][0] ? a[i++] : b[j++];
      const last = out[out.length - 1];
      if (last && next[0] <= last[1]) last[1] = Math.max(last[1], next[1]);
      else out.push([next[0], next[1]]);
    }
    return out;
  }
  function resolve(record, path) {
    let value = record;
    for (const part of path.split(".")) {
      value = value == null ? void 0 : value[part];
    }
    return value;
  }

  // node_modules/hyparquet/src/plan.js
  var runLimit = 1 << 21;
  var columnGapLimit = 1 << 13;
  function parquetPlan(options) {
    const { metadata, rowStart = 0, columns, useOffsetIndex = false } = options;
    if (!metadata) throw new Error("parquetPlan requires metadata");
    const groups = [];
    const fetches = [];
    const indexes = [];
    const scanPlan = parquetPlanGroups(options);
    for (const group of scanPlan.groups) {
      const groupPlan = parquetPlanGroup({ ...group, columns, useOffsetIndex });
      groups.push(...groupPlan.groups);
      fetches.push(...groupPlan.fetches);
      indexes.push(...groupPlan.indexes);
    }
    fetches.push(...indexes);
    return { metadata, rowStart, rowEnd: scanPlan.rowEnd, columns, fetches, groups };
  }
  function parquetPlanGroups({ metadata, rowStart = 0, rowEnd = Infinity, columns, filter, filterStrict = true, bloomFiltersByGroup, schemaElements, pageRangesByGroup, pageLocationsByGroup }) {
    if (!metadata) throw new Error("parquetPlan requires metadata");
    const schemaTree2 = parquetSchema(metadata);
    const physicalColumns = getPhysicalColumns(schemaTree2);
    const elementsByPath = filter ? {
      ...physicalSchemaElements(schemaTree2),
      ...schemaElements
    } : schemaElements;
    const groups = [];
    let groupStart = 0;
    for (let groupIndex = 0; groupIndex < metadata.row_groups.length; groupIndex++) {
      const rowGroup = metadata.row_groups[groupIndex];
      const groupRows = Number(rowGroup.num_rows);
      const groupEnd = groupStart + groupRows;
      if (groupRows > 0 && groupEnd > rowStart && groupStart < rowEnd && !canSkipRowGroup({
        rowGroup,
        physicalColumns,
        filter,
        strict: filterStrict,
        bloomFilters: bloomFiltersByGroup == null ? void 0 : bloomFiltersByGroup[groupIndex],
        schemaElements: elementsByPath
      })) {
        const selectStart = Math.max(rowStart - groupStart, 0);
        const selectEnd = Math.min(rowEnd - groupStart, groupRows);
        const pageRanges = pageRangesByGroup == null ? void 0 : pageRangesByGroup[groupIndex];
        const pageLocations = pageLocationsByGroup == null ? void 0 : pageLocationsByGroup[groupIndex];
        let ranges = pageRanges ? pageRanges.map(([start, end]) => {
          const range = [Math.max(start, selectStart), Math.min(end, selectEnd)];
          return range;
        }).filter(([start, end]) => start < end) : [[selectStart, selectEnd]];
        if (ranges.length > 1) {
          const canSplit = rowGroup.columns.every((chunk) => {
            var _a, _b;
            const columnName = (_a = chunk.meta_data) == null ? void 0 : _a.path_in_schema[0];
            const columnPath = (_b = chunk.meta_data) == null ? void 0 : _b.path_in_schema.join(".");
            if (columns && columnName && !columns.includes(columnName)) return true;
            return !!(chunk.offset_index_offset && chunk.offset_index_length) || !!(columnPath && (pageLocations == null ? void 0 : pageLocations[columnPath]));
          });
          ranges = canSplit ? coalesceOverlappingPageRanges(ranges, rowGroup, columns, pageLocations) : [[ranges[0][0], ranges[ranges.length - 1][1]]];
        }
        if (ranges.length) {
          groups.push({ rowGroup, groupIndex, groupStart, groupRows, ranges, pageRanges, pageLocations });
        }
      }
      groupStart = groupEnd;
    }
    return { groups, rowEnd: isFinite(rowEnd) ? rowEnd : groupStart };
  }
  function parquetPlanGroup({ rowGroup, groupStart, groupRows, ranges, columns, useOffsetIndex = false, pageRanges, pageLocations }) {
    const chunks = [];
    const fetches = [];
    const indexes = [];
    const narrowed = ranges.length > 1 || ranges[0][0] > 0 || ranges[0][1] < groupRows;
    for (const chunk of rowGroup.columns) {
      const meta = chunk.meta_data;
      if (chunk.file_path) throw new Error("parquet file_path not supported");
      if (!meta) throw new Error("parquet column metadata is undefined");
      if (columns && !columns.includes(meta.path_in_schema[0])) continue;
      const columnOffset = meta.dictionary_page_offset || meta.data_page_offset;
      const startByte = Number(columnOffset);
      const endByte = Number(columnOffset + meta.total_compressed_size);
      const chunkPageLocations = pageLocations == null ? void 0 : pageLocations[meta.path_in_schema.join(".")];
      if (chunkPageLocations && narrowed) {
        chunks.push({ columnMetadata: meta, pageLocations: chunkPageLocations, range: { startByte, endByte } });
      } else if ((useOffsetIndex || pageRanges) && chunk.offset_index_offset && chunk.offset_index_length && narrowed) {
        const startByte2 = Number(chunk.offset_index_offset);
        chunks.push({
          columnMetadata: meta,
          offsetIndex: { startByte: startByte2, endByte: startByte2 + chunk.offset_index_length },
          range: { startByte: Number(columnOffset), endByte }
        });
      } else {
        chunks.push({ columnMetadata: meta, range: { startByte, endByte } });
      }
    }
    const columnRanges = [];
    let run;
    for (const chunk of chunks) {
      if ("pageLocations" in chunk) continue;
      if ("offsetIndex" in chunk) {
        indexes.push(chunk.offsetIndex);
      } else if (columns) {
        columnRanges.push(chunk.range);
      } else if (run && chunk.range.endByte - run.startByte <= runLimit) {
        run.endByte = chunk.range.endByte;
      } else {
        if (run) fetches.push(run);
        run = { ...chunk.range };
      }
    }
    if (run) fetches.push(run);
    fetches.push(...coalesceByteRanges(columnRanges, columnGapLimit, runLimit));
    const groups = ranges.map(([selectStart, selectEnd]) => ({
      chunks,
      rowGroup,
      groupStart,
      groupRows,
      selectStart,
      selectEnd
    }));
    return { groups, fetches, indexes };
  }
  function coalesceOverlappingPageRanges(ranges, rowGroup, columns, pageLocations) {
    const selectedPageLayouts = rowGroup.columns.filter((chunk) => {
      var _a;
      return !columns || columns.includes(((_a = chunk.meta_data) == null ? void 0 : _a.path_in_schema[0]) || "");
    }).map((chunk) => {
      var _a;
      return pageLocations == null ? void 0 : pageLocations[((_a = chunk.meta_data) == null ? void 0 : _a.path_in_schema.join(".")) || ""];
    });
    const merged = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      const overlapsPage = last && selectedPageLayouts.some((pages) => {
        if (!pages) return true;
        const lastPages = pagesForRange(last, pages, Number(rowGroup.num_rows));
        const rangePages = pagesForRange(range, pages, Number(rowGroup.num_rows));
        return lastPages[0] <= rangePages[1] && rangePages[0] <= lastPages[1];
      });
      if (last && overlapsPage) last[1] = range[1];
      else merged.push([...range]);
    }
    return merged;
  }
  function pagesForRange([rangeStart, rangeEnd], pages, groupRows) {
    let first = Infinity;
    let last = -Infinity;
    for (let i = 0; i < pages.length; i++) {
      const pageStart = Number(pages[i].first_row_index);
      const pageEnd = i + 1 < pages.length ? Number(pages[i + 1].first_row_index) : groupRows;
      if (pageEnd > rangeStart && pageStart < rangeEnd) {
        first = Math.min(first, i);
        last = i;
      }
    }
    return [first, last];
  }
  async function prefetchBloomFilters({ file, metadata, filter, filterStrict = true }) {
    const result = metadata.row_groups.map(() => (
      /** @type {Record<string, BloomFilter>} */
      {}
    ));
    const eligibleCols = bloomEligibleColumns(filter);
    if (eligibleCols.size === 0) return result;
    const physicalColumns = getPhysicalColumns(parquetSchema(metadata));
    const tasks = [];
    metadata.row_groups.forEach((rowGroup, rgIdx) => {
      var _a;
      if (canSkipRowGroup({ rowGroup, physicalColumns, filter, strict: filterStrict })) return;
      for (const colName of eligibleCols) {
        const columnIdx = physicalColumns.indexOf(colName);
        if (columnIdx === -1) continue;
        const meta = (_a = rowGroup.columns[columnIdx]) == null ? void 0 : _a.meta_data;
        if (!(meta == null ? void 0 : meta.bloom_filter_offset) || !meta.bloom_filter_length) continue;
        const start = Number(meta.bloom_filter_offset);
        const end = start + meta.bloom_filter_length;
        tasks.push((async () => {
          const buffer = await file.slice(start, end);
          const bloom = readBloomFilter({ view: new DataView(buffer), offset: 0 });
          if (bloom) result[rgIdx][colName] = bloom;
        })());
      }
    });
    if (tasks.length) await Promise.all(tasks);
    return result;
  }
  async function prefetchPageIndexes({ file, metadata, filter, filterStrict = true, rowStart = 0, rowEnd = Infinity, columns, bloomFiltersByGroup, schemaElements, parsers }) {
    const pageRangesByGroup = metadata.row_groups.map(() => void 0);
    const pageLocationsByGroup = metadata.row_groups.map(() => (
      /** @type {Record<string, PageLocation[]>} */
      {}
    ));
    if (filter && "$nor" in filter && Array.isArray(filter.$nor)) {
      return { pageRangesByGroup, pageLocationsByGroup };
    }
    const filterColumns = pathsNeededForFilter(filter);
    if (!filterColumns.length) return { pageRangesByGroup, pageLocationsByGroup };
    const schemaTree2 = parquetSchema(metadata);
    const physicalColumns = getPhysicalColumns(schemaTree2);
    const elementsByPath = {
      ...physicalSchemaElements(schemaTree2),
      ...schemaElements
    };
    const indexRanges = [];
    const indexTasks = [];
    const candidateGroups = [];
    let groupStart = 0;
    metadata.row_groups.forEach((rowGroup, rgIdx) => {
      const groupRows = Number(rowGroup.num_rows);
      const groupEnd = groupStart + groupRows;
      const overlaps = groupRows > 0 && groupEnd > rowStart && groupStart < rowEnd;
      groupStart = groupEnd;
      if (!overlaps) return;
      if (canSkipRowGroup({ rowGroup, physicalColumns, filter, strict: filterStrict, bloomFilters: bloomFiltersByGroup == null ? void 0 : bloomFiltersByGroup[rgIdx], schemaElements: elementsByPath })) return;
      const columnPages = {};
      let columnTaskCount = 0;
      const scheduledOffsetPaths = /* @__PURE__ */ new Set();
      let hasFilterIndex = false;
      for (const columnName of filterColumns) {
        const columnIdx = physicalColumns.indexOf(columnName);
        if (columnIdx === -1) continue;
        const chunk = rowGroup.columns[columnIdx];
        const meta = chunk == null ? void 0 : chunk.meta_data;
        if (!meta) continue;
        if (!chunk.column_index_offset || !chunk.column_index_length) continue;
        if (!chunk.offset_index_offset || !chunk.offset_index_length) continue;
        const element = elementsByPath[columnName];
        if (!element) continue;
        hasFilterIndex = true;
        scheduledOffsetPaths.add(columnName);
        const columnIndexStart = Number(chunk.column_index_offset);
        const offsetIndexStart = Number(chunk.offset_index_offset);
        const columnIndexEnd = columnIndexStart + chunk.column_index_length;
        const offsetIndexEnd = offsetIndexStart + chunk.offset_index_length;
        indexRanges.push(
          { startByte: columnIndexStart, endByte: columnIndexEnd },
          { startByte: offsetIndexStart, endByte: offsetIndexEnd }
        );
        columnTaskCount++;
        indexTasks.push(async (prefetchedFile) => {
          const [columnIndexBuffer, offsetIndexBuffer] = await Promise.all([
            prefetchedFile.slice(columnIndexStart, columnIndexEnd),
            prefetchedFile.slice(offsetIndexStart, offsetIndexEnd)
          ]);
          const columnIndex = readColumnIndex({ view: new DataView(columnIndexBuffer), offset: 0 }, element, parsers);
          const offsetIndex = readOffsetIndex({ view: new DataView(offsetIndexBuffer), offset: 0 });
          pageLocationsByGroup[rgIdx][columnName] = offsetIndex.page_locations;
          columnPages[columnName] = {
            minValues: columnIndex.min_values,
            maxValues: columnIndex.max_values,
            nullPages: columnIndex.null_pages,
            nullCounts: columnIndex.null_counts,
            pageStarts: offsetIndex.page_locations.map((page) => Number(page.first_row_index)),
            element
          };
        });
      }
      if (hasFilterIndex) {
        for (const chunk of rowGroup.columns) {
          const meta = chunk.meta_data;
          if (!meta) continue;
          const columnName = meta.path_in_schema[0];
          const columnPath = meta.path_in_schema.join(".");
          if (columns && !columns.includes(columnName)) continue;
          if (scheduledOffsetPaths.has(columnPath)) continue;
          if (!chunk.offset_index_offset || !chunk.offset_index_length) continue;
          scheduledOffsetPaths.add(columnPath);
          const offsetIndexStart = Number(chunk.offset_index_offset);
          const offsetIndexEnd = offsetIndexStart + chunk.offset_index_length;
          indexRanges.push({ startByte: offsetIndexStart, endByte: offsetIndexEnd });
          columnTaskCount++;
          indexTasks.push(async (prefetchedFile) => {
            const offsetIndexBuffer = await prefetchedFile.slice(offsetIndexStart, offsetIndexEnd);
            const offsetIndex = readOffsetIndex({ view: new DataView(offsetIndexBuffer), offset: 0 });
            pageLocationsByGroup[rgIdx][columnPath] = offsetIndex.page_locations;
          });
        }
      }
      if (columnTaskCount) {
        candidateGroups.push({ rgIdx, groupRows, columnPages });
      }
    });
    if (indexTasks.length) {
      const prefetchedFile = prefetchAsyncBuffer(file, { fetches: coalesceByteRanges(indexRanges) });
      await Promise.all(indexTasks.map((task) => task(prefetchedFile)));
      for (const { rgIdx, groupRows, columnPages } of candidateGroups) {
        pageRangesByGroup[rgIdx] = filterPageRanges(filter, columnPages, groupRows, filterStrict);
      }
    }
    return { pageRangesByGroup, pageLocationsByGroup };
  }
  function coalesceByteRanges(ranges, maxGap = 0, maxSize = Infinity) {
    const sorted = ranges.map((range) => ({ ...range })).sort((a, b) => a.startByte - b.startByte || a.endByte - b.endByte);
    const merged = [];
    for (const range of sorted) {
      const last = merged[merged.length - 1];
      if (last && range.startByte <= last.endByte + maxGap && Math.max(last.endByte, range.endByte) - last.startByte <= maxSize) {
        last.endByte = Math.max(last.endByte, range.endByte);
      } else {
        merged.push(range);
      }
    }
    return merged;
  }
  function physicalSchemaElements(schemaTree2) {
    const elements = {};
    function traverse(node) {
      if (node.children.length) {
        for (const child of node.children) traverse(child);
      } else {
        elements[node.path.join(".")] = node.element;
      }
    }
    traverse(schemaTree2);
    return elements;
  }
  function prefetchAsyncBuffer(file, { fetches }) {
    const promises = fetches.map(({ startByte, endByte }) => file.slice(startByte, endByte));
    return {
      byteLength: file.byteLength,
      slice(start, end = file.byteLength) {
        const index = fetches.findIndex(({ startByte, endByte }) => startByte <= start && end <= endByte);
        if (index < 0) {
          return file.slice(start, end);
        }
        if (fetches[index].startByte !== start || fetches[index].endByte !== end) {
          const startOffset = start - fetches[index].startByte;
          const endOffset = end - fetches[index].startByte;
          if (promises[index] instanceof Promise) {
            return promises[index].then((buffer) => buffer.slice(startOffset, endOffset));
          } else {
            return promises[index].slice(startOffset, endOffset);
          }
        } else {
          return promises[index];
        }
      }
    };
  }

  // node_modules/hyparquet/src/variant.js
  var decoder3 = new TextDecoder();
  var metadataCache = /* @__PURE__ */ new WeakMap();
  function decodeVariantColumn(value, parsers = DEFAULT_PARSERS) {
    if (Array.isArray(value)) {
      return value.map((entry) => decodeVariantColumn(entry, parsers));
    }
    if (typeof value !== "object") return value;
    if ("metadata" in value) {
      const metadata = parseVariantMetadata(value.metadata);
      const shreddedFields = value.typed_value && decodeTypedValue(value.typed_value, metadata, parsers);
      const binaryValue = value.value && readVariant(makeReader(value.value), metadata, parsers);
      if (shreddedFields && binaryValue) {
        return { ...binaryValue, ...shreddedFields };
      }
      return shreddedFields != null ? shreddedFields : binaryValue;
    }
    return value;
  }
  function decodeTypedValue(typedValue, metadata, parsers) {
    if (typedValue instanceof Date) return typedValue;
    if (typedValue && typeof typedValue === "object" && !Array.isArray(typedValue) && !(typedValue instanceof Uint8Array)) {
      if ("typed_value" in typedValue && typedValue.typed_value !== null && typedValue.typed_value !== void 0) {
        return decodeTypedValue(typedValue.typed_value, metadata, parsers);
      }
      if ("value" in typedValue && typedValue.value instanceof Uint8Array) {
        return readVariant(makeReader(typedValue.value), metadata, parsers);
      }
      if ("typed_value" in typedValue || "value" in typedValue) {
        return null;
      }
      const result = {};
      for (const [key, field] of Object.entries(typedValue)) {
        if (!metadata.dictionary.includes(key)) continue;
        result[key] = decodeTypedValue(field, metadata, parsers);
      }
      return result;
    }
    if (typedValue instanceof Uint8Array) {
      return readVariant(makeReader(typedValue), metadata, parsers);
    }
    if (Array.isArray(typedValue)) {
      return typedValue.map((element) => decodeTypedValue(element, metadata, parsers));
    }
    return typedValue;
  }
  function makeReader(bytes) {
    return { view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 };
  }
  function parseVariantMetadata(bytes) {
    let bufferCache = metadataCache.get(bytes.buffer);
    if (!bufferCache) {
      bufferCache = /* @__PURE__ */ new Map();
      metadataCache.set(bytes.buffer, bufferCache);
    }
    const key = `${bytes.byteOffset}:${bytes.byteLength}`;
    const cached = bufferCache.get(key);
    if (cached) return cached;
    const reader = makeReader(bytes);
    const header = reader.view.getUint8(reader.offset++);
    const version = header & 15;
    if (version !== 1) throw new Error(`parquet unsupported variant metadata version: ${version}`);
    const sorted = (header >> 4 & 1) === 1;
    const offsetSize = (header >> 6 & 3) + 1;
    const dictionarySize = readUnsigned(reader, offsetSize);
    const offsets = new Array(dictionarySize + 1);
    for (let i = 0; i < offsets.length; i++) {
      offsets[i] = readUnsigned(reader, offsetSize);
    }
    const base = reader.offset;
    const dictionary = new Array(dictionarySize);
    for (let i = 0; i < dictionarySize; i++) {
      const start = offsets[i];
      const end = offsets[i + 1];
      const strBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + base + start, end - start);
      dictionary[i] = decoder3.decode(strBytes);
    }
    const metadata = { dictionary, sorted };
    bufferCache.set(key, metadata);
    return metadata;
  }
  function readUnsigned(reader, byteWidth2) {
    let value = 0;
    for (let i = 0; i < byteWidth2; i++) {
      value |= reader.view.getUint8(reader.offset + i) << i * 8;
    }
    reader.offset += byteWidth2;
    return value;
  }
  function readVariant(reader, metadata, parsers) {
    const typeByte = reader.view.getUint8(reader.offset++);
    const basicType = typeByte & 3;
    const header = typeByte >> 2;
    if (basicType === 0) return readVariantPrimitive(reader, header, parsers);
    if (basicType === 2) return readVariantObject(reader, header, metadata, parsers);
    if (basicType === 3) return readVariantArray(reader, header, metadata, parsers);
    const bytes = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, header);
    reader.offset += header;
    return decoder3.decode(bytes);
  }
  function readVariantPrimitive(reader, typeId, parsers) {
    switch (typeId) {
      case 0:
        return null;
      case 1:
        return true;
      case 2:
        return false;
      case 3: {
        const value = reader.view.getInt8(reader.offset);
        reader.offset += 1;
        return value;
      }
      case 4: {
        const value = reader.view.getInt16(reader.offset, true);
        reader.offset += 2;
        return value;
      }
      case 5: {
        const value = reader.view.getInt32(reader.offset, true);
        reader.offset += 4;
        return value;
      }
      case 6: {
        const value = reader.view.getBigInt64(reader.offset, true);
        reader.offset += 8;
        return value;
      }
      case 7: {
        const value = reader.view.getFloat64(reader.offset, true);
        reader.offset += 8;
        return value;
      }
      case 8:
        return readVariantDecimal(reader, 4);
      case 9:
        return readVariantDecimal(reader, 8);
      case 10:
        return readVariantDecimal(reader, 16);
      case 11: {
        const value = reader.view.getInt32(reader.offset, true);
        reader.offset += 4;
        return parsers.dateFromDays(value);
      }
      case 12:
      // timestamp_micros (utc)
      case 13: {
        const value = reader.view.getBigInt64(reader.offset, true);
        reader.offset += 8;
        return parsers.timestampFromMicroseconds(value);
      }
      case 14: {
        const value = reader.view.getFloat32(reader.offset, true);
        reader.offset += 4;
        return value;
      }
      case 15:
        return readVariantBinary(reader);
      case 16: {
        const bytes = readVariantBinary(reader);
        return decoder3.decode(bytes);
      }
      case 17: {
        const value = reader.view.getBigInt64(reader.offset, true);
        reader.offset += 8;
        return value;
      }
      case 18:
      // timestamp_nanos (utc)
      case 19: {
        const value = reader.view.getBigInt64(reader.offset, true);
        reader.offset += 8;
        return parsers.timestampFromNanoseconds(value);
      }
      case 20: {
        const bytes = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, 16);
        reader.offset += 16;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }
      default:
        throw new Error(`parquet unsupported variant primitive type: ${typeId}`);
    }
  }
  function readVariantObject(reader, header, metadata, parsers) {
    const offsetWidth = (header & 3) + 1;
    const idWidth = (header >> 2 & 3) + 1;
    const isLarge = header >> 4 & 1;
    const numElements = isLarge ? readUnsigned(reader, 4) : reader.view.getUint8(reader.offset++);
    const fieldIds = new Array(numElements);
    for (let i = 0; i < numElements; i++) {
      fieldIds[i] = readUnsigned(reader, idWidth);
    }
    const offsets = new Array(numElements + 1);
    for (let i = 0; i < offsets.length; i++) {
      offsets[i] = readUnsigned(reader, offsetWidth);
    }
    const out = {};
    for (let i = 0; i < numElements; i++) {
      const key = metadata.dictionary[fieldIds[i]];
      const valueReader = {
        view: reader.view,
        offset: reader.offset + offsets[i]
      };
      out[key] = readVariant(valueReader, metadata, parsers);
    }
    reader.offset += offsets[offsets.length - 1];
    return out;
  }
  function readVariantArray(reader, header, metadata, parsers) {
    const fieldOffsetSize = header & 3;
    const isLarge = header >> 2 & 1;
    const offsetWidth = fieldOffsetSize + 1;
    const numElements = readUnsigned(reader, isLarge ? 4 : 1);
    const offsets = new Array(numElements + 1);
    for (let i = 0; i < offsets.length; i++) {
      offsets[i] = readUnsigned(reader, offsetWidth);
    }
    const valuesStart = reader.offset;
    const result = new Array(numElements);
    for (let i = 0; i < numElements; i++) {
      const valueReader = {
        view: reader.view,
        offset: valuesStart + offsets[i]
      };
      result[i] = readVariant(valueReader, metadata, parsers);
    }
    reader.offset = valuesStart + offsets[offsets.length - 1];
    return result;
  }
  function readVariantDecimal(reader, width) {
    const scale = reader.view.getUint8(reader.offset);
    reader.offset += 1;
    let unscaled;
    if (width === 4) {
      unscaled = BigInt(reader.view.getInt32(reader.offset, true));
      reader.offset += 4;
    } else if (width === 8) {
      unscaled = reader.view.getBigInt64(reader.offset, true);
      reader.offset += 8;
    } else {
      const low = reader.view.getBigUint64(reader.offset, true);
      const high = reader.view.getBigInt64(reader.offset + 8, true);
      unscaled = high << /* @__PURE__ */ BigInt("64") | low;
      reader.offset += 16;
    }
    return Number(unscaled) * 10 ** -scale;
  }
  function readVariantBinary(reader) {
    const length = reader.view.getUint32(reader.offset, true);
    reader.offset += 4;
    const bytes = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, length);
    reader.offset += length;
    return bytes;
  }

  // node_modules/hyparquet/src/assemble.js
  function assembleLists(output, definitionLevels, repetitionLevels, values, schemaPath) {
    const maxDefinitionLevel = getMaxDefinitionLevel(schemaPath);
    if (!(definitionLevels == null ? void 0 : definitionLevels.length) && !repetitionLevels.length) {
      if (!maxDefinitionLevel || !values.length) return values;
      definitionLevels = new Array(values.length).fill(maxDefinitionLevel);
    }
    const n = (definitionLevels == null ? void 0 : definitionLevels.length) || repetitionLevels.length;
    const repetitionPath = schemaPath.map(({ element }) => element.repetition_type);
    let valueIndex = 0;
    const containerStack = [output];
    let currentContainer = output;
    let currentDepth = 0;
    let currentDefLevel = 0;
    let currentRepLevel = 0;
    if (repetitionLevels[0]) {
      while (currentDepth < repetitionPath.length - 2 && currentRepLevel < repetitionLevels[0]) {
        currentDepth++;
        if (repetitionPath[currentDepth] !== "REQUIRED") {
          currentContainer = currentContainer.at(-1);
          containerStack.push(currentContainer);
          currentDefLevel++;
        }
        if (repetitionPath[currentDepth] === "REPEATED") currentRepLevel++;
      }
    }
    for (let i = 0; i < n; i++) {
      const def = (definitionLevels == null ? void 0 : definitionLevels.length) ? definitionLevels[i] : maxDefinitionLevel;
      const rep = repetitionLevels[i];
      while (currentDepth && (rep < currentRepLevel || repetitionPath[currentDepth] !== "REPEATED")) {
        if (repetitionPath[currentDepth] !== "REQUIRED") {
          containerStack.pop();
          currentDefLevel--;
        }
        if (repetitionPath[currentDepth] === "REPEATED") currentRepLevel--;
        currentDepth--;
      }
      currentContainer = containerStack.at(-1);
      while ((currentDepth < repetitionPath.length - 2 || repetitionPath[currentDepth + 1] === "REPEATED") && (currentDefLevel < def || repetitionPath[currentDepth + 1] === "REQUIRED")) {
        currentDepth++;
        if (repetitionPath[currentDepth] !== "REQUIRED") {
          const newList = [];
          currentContainer.push(newList);
          currentContainer = newList;
          containerStack.push(newList);
          currentDefLevel++;
        }
        if (repetitionPath[currentDepth] === "REPEATED") currentRepLevel++;
      }
      if (def === maxDefinitionLevel) {
        currentContainer.push(values[valueIndex++]);
      } else if (currentDepth === repetitionPath.length - 2) {
        currentContainer.push(null);
      } else {
        currentContainer.push([]);
      }
    }
    if (!output.length) {
      for (let i = 0; i < maxDefinitionLevel; i++) {
        const newList = [];
        currentContainer.push(newList);
        currentContainer = newList;
      }
    }
    return output;
  }
  function assembleNested(subcolumnData, schema, parsers, depth = 0) {
    var _a;
    const path = schema.path.join(".");
    const optional = schema.element.repetition_type === "OPTIONAL";
    const nextDepth = optional ? depth + 1 : depth;
    if (isListLike(schema)) {
      let sublist = schema.children[0];
      let subDepth = nextDepth;
      if (sublist.children.length === 1) {
        sublist = sublist.children[0];
        subDepth++;
      }
      assembleNested(subcolumnData, sublist, parsers, subDepth);
      const subcolumn = sublist.path.join(".");
      const values = subcolumnData.get(subcolumn);
      if (!values) throw new Error("parquet list column missing values");
      if (optional) flattenAtDepth(values, depth);
      subcolumnData.set(path, values);
      subcolumnData.delete(subcolumn);
      return;
    }
    if (isMapLike(schema)) {
      const mapName = schema.children[0].element.name;
      assembleNested(subcolumnData, schema.children[0].children[0], parsers, nextDepth + 1);
      assembleNested(subcolumnData, schema.children[0].children[1], parsers, nextDepth + 1);
      const keys = subcolumnData.get(`${path}.${mapName}.key`);
      const values = subcolumnData.get(`${path}.${mapName}.value`);
      if (!keys) throw new Error("parquet map column missing keys");
      if (!values) throw new Error("parquet map column missing values");
      if (keys.length !== values.length) {
        throw new Error("parquet map column key/value length mismatch");
      }
      const out = assembleMaps(keys, values, nextDepth);
      if (optional) flattenAtDepth(out, depth);
      subcolumnData.delete(`${path}.${mapName}.key`);
      subcolumnData.delete(`${path}.${mapName}.value`);
      subcolumnData.set(path, out);
      return;
    }
    if (schema.children.length) {
      const invertDepth = schema.element.repetition_type === "REQUIRED" ? depth : depth + 1;
      const struct = {};
      for (const child of schema.children) {
        assembleNested(subcolumnData, child, parsers, invertDepth);
        const childData = subcolumnData.get(child.path.join("."));
        if (!childData) throw new Error("parquet struct missing child data");
        struct[child.element.name] = childData;
      }
      for (const child of schema.children) {
        subcolumnData.delete(child.path.join("."));
      }
      let inverted = invertStruct(struct, invertDepth);
      if (((_a = schema.element.logical_type) == null ? void 0 : _a.type) === "VARIANT") {
        inverted = decodeVariantColumn(inverted, parsers);
      }
      if (optional) flattenAtDepth(inverted, depth);
      subcolumnData.set(path, inverted);
    }
  }
  function flattenAtDepth(arr, depth) {
    for (let i = 0; i < arr.length; i++) {
      if (depth) {
        flattenAtDepth(arr[i], depth - 1);
      } else {
        arr[i] = arr[i][0];
      }
    }
  }
  function assembleMaps(keys, values, depth) {
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      if (depth) {
        out.push(assembleMaps(keys[i], values[i], depth - 1));
      } else {
        if (keys[i]) {
          const obj = {};
          for (let j = 0; j < keys[i].length; j++) {
            const value = values[i][j];
            obj[keys[i][j]] = value === void 0 ? null : value;
          }
          out.push(obj);
        } else {
          out.push(void 0);
        }
      }
    }
    return out;
  }
  function invertStruct(struct, depth) {
    var _a;
    const keys = Object.keys(struct);
    const length = (_a = struct[keys[0]]) == null ? void 0 : _a.length;
    const out = [];
    for (let i = 0; i < length; i++) {
      const obj = {};
      for (const key of keys) {
        if (struct[key].length !== length) throw new Error("parquet struct parsing error");
        obj[key] = struct[key][i];
      }
      if (depth) {
        out.push(invertStruct(obj, depth - 1));
      } else {
        out.push(obj);
      }
    }
    return out;
  }

  // node_modules/hyparquet/src/delta.js
  function deltaBinaryUnpack(reader, count, output) {
    if (output instanceof Int32Array) {
      deltaBinaryUnpackInt32(reader, count, output);
      return;
    }
    const blockSize = readVarInt(reader);
    const miniblockPerBlock = readVarInt(reader);
    readVarInt(reader);
    let value = readZigZagBigInt(reader);
    let outputIndex = 0;
    output[outputIndex++] = value;
    const valuesPerMiniblock = blockSize / miniblockPerBlock;
    while (outputIndex < count) {
      const minDelta = readZigZagBigInt(reader);
      const bitWidths = new Uint8Array(miniblockPerBlock);
      for (let i = 0; i < miniblockPerBlock; i++) {
        bitWidths[i] = reader.view.getUint8(reader.offset++);
      }
      for (let i = 0; i < miniblockPerBlock && outputIndex < count; i++) {
        const bitWidth2 = bitWidths[i];
        if (bitWidth2) {
          let bitpackPos = 0;
          let miniblockCount = valuesPerMiniblock;
          const mask = (/* @__PURE__ */ BigInt("1") << BigInt(bitWidth2)) - /* @__PURE__ */ BigInt("1");
          while (miniblockCount && outputIndex < count) {
            let bits = BigInt(reader.view.getUint32(reader.offset, true) >>> bitpackPos) & mask;
            bitpackPos += bitWidth2;
            while (bitpackPos >= 32) {
              bitpackPos -= 32;
              reader.offset += 4;
              if (bitpackPos) {
                bits |= BigInt(reader.view.getUint32(reader.offset, true)) << BigInt(bitWidth2 - bitpackPos) & mask;
              }
            }
            const delta = minDelta + bits;
            value += delta;
            output[outputIndex++] = value;
            miniblockCount--;
          }
          if (miniblockCount) {
            reader.offset += Math.ceil((miniblockCount * bitWidth2 + bitpackPos) / 8);
          }
        } else {
          for (let j = 0; j < valuesPerMiniblock && outputIndex < count; j++) {
            value += minDelta;
            output[outputIndex++] = value;
          }
        }
      }
    }
  }
  function deltaBinaryUnpackInt32(reader, count, output) {
    const blockSize = readVarInt(reader);
    const miniblockPerBlock = readVarInt(reader);
    readVarInt(reader);
    let value = readZigZag(reader);
    let outputIndex = 0;
    output[outputIndex++] = value;
    const valuesPerMiniblock = blockSize / miniblockPerBlock;
    while (outputIndex < count) {
      const minDelta = readZigZag(reader);
      const bitWidthsOffset = reader.offset;
      reader.offset += miniblockPerBlock;
      for (let i = 0; i < miniblockPerBlock && outputIndex < count; i++) {
        const bitWidth2 = reader.view.getUint8(bitWidthsOffset + i);
        const end = reader.offset + valuesPerMiniblock * bitWidth2 / 8;
        let bitOffset = 0;
        for (let j = 0; j < valuesPerMiniblock && outputIndex < count; j++) {
          let residual = 0;
          let bitsRead = 0;
          while (bitsRead < bitWidth2) {
            const bitsToRead = Math.min(8 - bitOffset, bitWidth2 - bitsRead);
            residual |= (reader.view.getUint8(reader.offset) >>> bitOffset & (1 << bitsToRead) - 1) << bitsRead;
            bitsRead += bitsToRead;
            bitOffset += bitsToRead;
            if (bitOffset === 8) {
              bitOffset = 0;
              reader.offset++;
            }
          }
          value = value + minDelta + residual | 0;
          output[outputIndex++] = value;
        }
        reader.offset = end;
      }
    }
  }
  function deltaLengthByteArray(reader, count, output) {
    const lengths = new Int32Array(count);
    deltaBinaryUnpack(reader, count, lengths);
    for (let i = 0; i < count; i++) {
      output[i] = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, lengths[i]);
      reader.offset += lengths[i];
    }
  }
  function deltaByteArray(reader, count, output) {
    const prefixData = new Int32Array(count);
    deltaBinaryUnpack(reader, count, prefixData);
    const suffixData = new Int32Array(count);
    deltaBinaryUnpack(reader, count, suffixData);
    for (let i = 0; i < count; i++) {
      const suffix = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, suffixData[i]);
      if (prefixData[i]) {
        output[i] = new Uint8Array(prefixData[i] + suffixData[i]);
        output[i].set(output[i - 1].subarray(0, prefixData[i]));
        output[i].set(suffix, prefixData[i]);
      } else {
        output[i] = suffix;
      }
      reader.offset += suffixData[i];
    }
  }

  // node_modules/hyparquet/src/encoding.js
  function readRleBitPackedHybrid(reader, width, output, length) {
    if (length === void 0) {
      length = reader.view.getUint32(reader.offset, true);
      reader.offset += 4;
    }
    const startOffset = reader.offset;
    let seen = 0;
    while (seen < output.length) {
      const header = readVarInt(reader);
      if (header & 1) {
        seen = readBitPacked(reader, header, width, output, seen);
      } else {
        const count = header >>> 1;
        readRle(reader, count, width, output, seen);
        seen += count;
      }
    }
    reader.offset = startOffset + length;
  }
  function readRle(reader, count, bitWidth2, output, seen) {
    const width = bitWidth2 + 7 >> 3;
    let value = 0;
    for (let i = 0; i < width; i++) {
      value |= reader.view.getUint8(reader.offset++) << (i << 3);
    }
    for (let i = 0; i < count; i++) {
      output[seen + i] = value;
    }
  }
  function readBitPacked(reader, header, bitWidth2, output, seen) {
    let count = header >> 1 << 3;
    const mask = (1 << bitWidth2) - 1;
    let data = 0;
    if (reader.offset < reader.view.byteLength) {
      data = reader.view.getUint8(reader.offset++);
    } else if (mask) {
      throw new Error(`parquet bitpack offset ${reader.offset} out of range`);
    }
    let left = 8;
    let right = 0;
    while (count) {
      if (right > 8) {
        right -= 8;
        left -= 8;
        data >>>= 8;
      } else if (left - right < bitWidth2) {
        data |= reader.view.getUint8(reader.offset) << left;
        reader.offset++;
        left += 8;
      } else {
        if (seen < output.length) {
          output[seen++] = data >> right & mask;
        }
        count--;
        right += bitWidth2;
      }
    }
    return seen;
  }
  function byteStreamSplit(reader, count, type, typeLength) {
    const width = byteWidth(type, typeLength);
    const bytes = new Uint8Array(count * width);
    for (let b = 0; b < width; b++) {
      for (let i = 0; i < count; i++) {
        bytes[i * width + b] = reader.view.getUint8(reader.offset++);
      }
    }
    if (type === "FLOAT") return new Float32Array(bytes.buffer);
    else if (type === "DOUBLE") return new Float64Array(bytes.buffer);
    else if (type === "INT32") return new Int32Array(bytes.buffer);
    else if (type === "INT64") return new BigInt64Array(bytes.buffer);
    else if (type === "FIXED_LEN_BYTE_ARRAY") {
      const split = new Array(count);
      for (let i = 0; i < count; i++) {
        split[i] = bytes.subarray(i * width, (i + 1) * width);
      }
      return split;
    }
    throw new Error(`parquet byte_stream_split unsupported type: ${type}`);
  }
  function byteWidth(type, typeLength) {
    switch (type) {
      case "INT32":
      case "FLOAT":
        return 4;
      case "INT64":
      case "DOUBLE":
        return 8;
      case "FIXED_LEN_BYTE_ARRAY":
        if (!typeLength) throw new Error("parquet byteWidth missing type_length");
        return typeLength;
      default:
        throw new Error(`parquet unsupported type: ${type}`);
    }
  }

  // node_modules/hyparquet/src/plain.js
  function readPlain(reader, type, count, fixedLength) {
    if (count === 0) return [];
    if (type === "BOOLEAN") {
      return readPlainBoolean(reader, count);
    } else if (type === "INT32") {
      return readPlainInt32(reader, count);
    } else if (type === "INT64") {
      return readPlainInt64(reader, count);
    } else if (type === "INT96") {
      return readPlainInt96(reader, count);
    } else if (type === "FLOAT") {
      return readPlainFloat(reader, count);
    } else if (type === "DOUBLE") {
      return readPlainDouble(reader, count);
    } else if (type === "BYTE_ARRAY") {
      return readPlainByteArray(reader, count);
    } else if (type === "FIXED_LEN_BYTE_ARRAY") {
      if (!fixedLength) throw new Error("parquet missing fixed length");
      return readPlainByteArrayFixed(reader, count, fixedLength);
    } else {
      throw new Error(`parquet unhandled type: ${type}`);
    }
  }
  function readPlainBoolean(reader, count) {
    const values = new Array(count);
    for (let i = 0; i < count; i++) {
      const byteOffset = reader.offset + (i / 8 | 0);
      const bitOffset = i % 8;
      const byte = reader.view.getUint8(byteOffset);
      values[i] = (byte & 1 << bitOffset) !== 0;
    }
    reader.offset += Math.ceil(count / 8);
    return values;
  }
  function readPlainInt32(reader, count) {
    const values = (reader.view.byteOffset + reader.offset) % 4 ? new Int32Array(align(reader.view.buffer, reader.view.byteOffset + reader.offset, count * 4)) : new Int32Array(reader.view.buffer, reader.view.byteOffset + reader.offset, count);
    reader.offset += count * 4;
    return values;
  }
  function readPlainInt64(reader, count) {
    const values = (reader.view.byteOffset + reader.offset) % 8 ? new BigInt64Array(align(reader.view.buffer, reader.view.byteOffset + reader.offset, count * 8)) : new BigInt64Array(reader.view.buffer, reader.view.byteOffset + reader.offset, count);
    reader.offset += count * 8;
    return values;
  }
  function readPlainInt96(reader, count) {
    const values = new Array(count);
    for (let i = 0; i < count; i++) {
      const low = reader.view.getBigInt64(reader.offset + i * 12, true);
      const high = reader.view.getInt32(reader.offset + i * 12 + 8, true);
      values[i] = BigInt(high) << /* @__PURE__ */ BigInt("64") | low;
    }
    reader.offset += count * 12;
    return values;
  }
  function readPlainFloat(reader, count) {
    const values = (reader.view.byteOffset + reader.offset) % 4 ? new Float32Array(align(reader.view.buffer, reader.view.byteOffset + reader.offset, count * 4)) : new Float32Array(reader.view.buffer, reader.view.byteOffset + reader.offset, count);
    reader.offset += count * 4;
    return values;
  }
  function readPlainDouble(reader, count) {
    const values = (reader.view.byteOffset + reader.offset) % 8 ? new Float64Array(align(reader.view.buffer, reader.view.byteOffset + reader.offset, count * 8)) : new Float64Array(reader.view.buffer, reader.view.byteOffset + reader.offset, count);
    reader.offset += count * 8;
    return values;
  }
  function readPlainByteArray(reader, count) {
    const values = new Array(count);
    for (let i = 0; i < count; i++) {
      const length = reader.view.getUint32(reader.offset, true);
      reader.offset += 4;
      values[i] = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, length);
      reader.offset += length;
    }
    return values;
  }
  function readPlainByteArrayFixed(reader, count, fixedLength) {
    const values = new Array(count);
    for (let i = 0; i < count; i++) {
      values[i] = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, fixedLength);
      reader.offset += fixedLength;
    }
    return values;
  }
  function align(buffer, offset, size) {
    const aligned = new ArrayBuffer(size);
    new Uint8Array(aligned).set(new Uint8Array(buffer, offset, size));
    return aligned;
  }

  // node_modules/hyparquet/src/snappy.js
  var WORD_MASK = [0, 255, 65535, 16777215, 4294967295];
  function copyBytes(fromArray, fromPos, toArray, toPos, length) {
    for (let i = 0; i < length; i++) {
      toArray[toPos + i] = fromArray[fromPos + i];
    }
  }
  function snappyUncompress(input, output) {
    const inputLength = input.byteLength;
    const outputLength = output.byteLength;
    let pos = 0;
    let outPos = 0;
    while (pos < inputLength) {
      const c = input[pos];
      pos++;
      if (c < 128) {
        break;
      }
    }
    if (outputLength && pos >= inputLength) {
      throw new Error("invalid snappy length header");
    }
    while (pos < inputLength) {
      const c = input[pos];
      let len = 0;
      pos++;
      if (pos >= inputLength) {
        throw new Error("missing eof marker");
      }
      if ((c & 3) === 0) {
        let len2 = (c >>> 2) + 1;
        if (len2 > 60) {
          if (pos + 3 >= inputLength) {
            throw new Error("snappy error literal pos + 3 >= inputLength");
          }
          const lengthSize = len2 - 60;
          len2 = input[pos] + (input[pos + 1] << 8) + (input[pos + 2] << 16) + (input[pos + 3] << 24);
          len2 = (len2 & WORD_MASK[lengthSize]) + 1;
          pos += lengthSize;
        }
        if (pos + len2 > inputLength) {
          throw new Error("snappy error literal exceeds input length");
        }
        copyBytes(input, pos, output, outPos, len2);
        pos += len2;
        outPos += len2;
      } else {
        let offset = 0;
        switch (c & 3) {
          case 1:
            len = (c >>> 2 & 7) + 4;
            offset = input[pos] + (c >>> 5 << 8);
            pos++;
            break;
          case 2:
            if (inputLength <= pos + 1) {
              throw new Error("snappy error end of input");
            }
            len = (c >>> 2) + 1;
            offset = input[pos] + (input[pos + 1] << 8);
            pos += 2;
            break;
          case 3:
            if (inputLength <= pos + 3) {
              throw new Error("snappy error end of input");
            }
            len = (c >>> 2) + 1;
            offset = input[pos] + (input[pos + 1] << 8) + (input[pos + 2] << 16) + (input[pos + 3] << 24);
            pos += 4;
            break;
          default:
            break;
        }
        if (offset === 0 || isNaN(offset)) {
          throw new Error(`invalid offset ${offset} pos ${pos} inputLength ${inputLength}`);
        }
        if (offset > outPos) {
          throw new Error("cannot copy from before start of buffer");
        }
        copyBytes(output, outPos - offset, output, outPos, len);
        outPos += len;
      }
    }
    if (outPos !== outputLength) throw new Error("premature end of input");
  }

  // node_modules/hyparquet/src/datapage.js
  function readDataPage(bytes, daph, { type, element, schemaPath }) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const reader = { view, offset: 0 };
    let dataPage;
    const repetitionLevels = readRepetitionLevels(reader, daph, schemaPath);
    const { definitionLevels, numNulls } = readDefinitionLevels(reader, daph, schemaPath);
    const nValues = daph.num_values - numNulls;
    if (daph.encoding === "PLAIN") {
      dataPage = readPlain(reader, type, nValues, element.type_length);
    } else if (daph.encoding === "PLAIN_DICTIONARY" || daph.encoding === "RLE_DICTIONARY" || daph.encoding === "RLE") {
      const bitWidth2 = type === "BOOLEAN" ? 1 : view.getUint8(reader.offset++);
      if (bitWidth2) {
        dataPage = new Array(nValues);
        if (type === "BOOLEAN") {
          readRleBitPackedHybrid(reader, bitWidth2, dataPage);
          dataPage = dataPage.map((x) => !!x);
        } else {
          readRleBitPackedHybrid(reader, bitWidth2, dataPage, view.byteLength - reader.offset);
        }
      } else {
        dataPage = new Uint8Array(nValues);
      }
    } else if (daph.encoding === "BYTE_STREAM_SPLIT") {
      dataPage = byteStreamSplit(reader, nValues, type, element.type_length);
    } else if (daph.encoding === "DELTA_BINARY_PACKED") {
      const int32 = type === "INT32";
      dataPage = int32 ? new Int32Array(nValues) : new BigInt64Array(nValues);
      deltaBinaryUnpack(reader, nValues, dataPage);
    } else if (daph.encoding === "DELTA_LENGTH_BYTE_ARRAY") {
      dataPage = new Array(nValues);
      deltaLengthByteArray(reader, nValues, dataPage);
    } else {
      throw new Error(`parquet unsupported encoding: ${daph.encoding}`);
    }
    return { definitionLevels, repetitionLevels, dataPage };
  }
  function readRepetitionLevels(reader, daph, schemaPath) {
    if (schemaPath.length > 1) {
      const maxRepetitionLevel = getMaxRepetitionLevel(schemaPath);
      if (maxRepetitionLevel) {
        const values = new Array(daph.num_values);
        readRleBitPackedHybrid(reader, bitWidth(maxRepetitionLevel), values);
        return values;
      }
    }
    return [];
  }
  function readDefinitionLevels(reader, daph, schemaPath) {
    const maxDefinitionLevel = getMaxDefinitionLevel(schemaPath);
    if (!maxDefinitionLevel) return { definitionLevels: [], numNulls: 0 };
    const definitionLevels = new Array(daph.num_values);
    readRleBitPackedHybrid(reader, bitWidth(maxDefinitionLevel), definitionLevels);
    let numNulls = daph.num_values;
    for (const def of definitionLevels) {
      if (def === maxDefinitionLevel) numNulls--;
    }
    if (numNulls === 0) definitionLevels.length = 0;
    return { definitionLevels, numNulls };
  }
  function decompressPage(compressedBytes, uncompressed_page_size, codec, compressors2) {
    let page;
    const customDecompressor = compressors2 == null ? void 0 : compressors2[codec];
    if (codec === "UNCOMPRESSED") {
      page = compressedBytes;
    } else if (customDecompressor) {
      page = customDecompressor(compressedBytes, uncompressed_page_size);
    } else if (codec === "SNAPPY") {
      page = new Uint8Array(uncompressed_page_size);
      snappyUncompress(compressedBytes, page);
    } else {
      throw new Error(`parquet unsupported compression codec: ${codec}`);
    }
    if ((page == null ? void 0 : page.length) !== uncompressed_page_size) {
      throw new Error(`parquet decompressed page length ${page == null ? void 0 : page.length} does not match header ${uncompressed_page_size}`);
    }
    return page;
  }
  function readDataPageV2(compressedBytes, ph, columnDecoder) {
    const view = new DataView(compressedBytes.buffer, compressedBytes.byteOffset, compressedBytes.byteLength);
    const reader = { view, offset: 0 };
    const { type, element, schemaPath, codec, compressors: compressors2 } = columnDecoder;
    const daph2 = ph.data_page_header_v2;
    if (!daph2) throw new Error("parquet data page header v2 is undefined");
    const repetitionLevels = readRepetitionLevelsV2(reader, daph2, schemaPath);
    reader.offset = daph2.repetition_levels_byte_length;
    const definitionLevels = readDefinitionLevelsV2(reader, daph2, schemaPath);
    const uncompressedPageSize = ph.uncompressed_page_size - daph2.definition_levels_byte_length - daph2.repetition_levels_byte_length;
    let page = compressedBytes.subarray(reader.offset);
    if (daph2.is_compressed !== false) {
      page = decompressPage(page, uncompressedPageSize, codec, compressors2);
    }
    const pageView = new DataView(page.buffer, page.byteOffset, page.byteLength);
    const pageReader = { view: pageView, offset: 0 };
    let dataPage;
    const nValues = daph2.num_values - daph2.num_nulls;
    if (daph2.encoding === "PLAIN") {
      dataPage = readPlain(pageReader, type, nValues, element.type_length);
    } else if (daph2.encoding === "RLE") {
      dataPage = new Array(nValues);
      readRleBitPackedHybrid(pageReader, 1, dataPage);
      dataPage = dataPage.map((x) => !!x);
    } else if (daph2.encoding === "PLAIN_DICTIONARY" || daph2.encoding === "RLE_DICTIONARY") {
      const bitWidth2 = pageView.getUint8(pageReader.offset++);
      dataPage = new Array(nValues);
      readRleBitPackedHybrid(pageReader, bitWidth2, dataPage, uncompressedPageSize - 1);
    } else if (daph2.encoding === "DELTA_BINARY_PACKED") {
      const int32 = type === "INT32";
      dataPage = int32 ? new Int32Array(nValues) : new BigInt64Array(nValues);
      deltaBinaryUnpack(pageReader, nValues, dataPage);
    } else if (daph2.encoding === "DELTA_LENGTH_BYTE_ARRAY") {
      dataPage = new Array(nValues);
      deltaLengthByteArray(pageReader, nValues, dataPage);
    } else if (daph2.encoding === "DELTA_BYTE_ARRAY") {
      dataPage = new Array(nValues);
      deltaByteArray(pageReader, nValues, dataPage);
    } else if (daph2.encoding === "BYTE_STREAM_SPLIT") {
      dataPage = byteStreamSplit(pageReader, nValues, type, element.type_length);
    } else {
      throw new Error(`parquet unsupported encoding: ${daph2.encoding}`);
    }
    return { definitionLevels, repetitionLevels, dataPage };
  }
  function readRepetitionLevelsV2(reader, daph2, schemaPath) {
    const maxRepetitionLevel = getMaxRepetitionLevel(schemaPath);
    if (!maxRepetitionLevel) return [];
    const values = new Array(daph2.num_values);
    readRleBitPackedHybrid(reader, bitWidth(maxRepetitionLevel), values, daph2.repetition_levels_byte_length);
    return values;
  }
  function readDefinitionLevelsV2(reader, daph2, schemaPath) {
    const maxDefinitionLevel = getMaxDefinitionLevel(schemaPath);
    if (maxDefinitionLevel) {
      const values = new Array(daph2.num_values);
      readRleBitPackedHybrid(reader, bitWidth(maxDefinitionLevel), values, daph2.definition_levels_byte_length);
      return values;
    }
  }
  function bitWidth(value) {
    return 32 - Math.clz32(value);
  }

  // node_modules/hyparquet/src/column.js
  function readColumn(reader, { groupStart, selectStart, selectEnd }, columnDecoder, onPage) {
    const { pathInSchema, schemaPath } = columnDecoder;
    const isFlat = isFlatColumn(schemaPath);
    const chunks = [];
    let dictionary = void 0;
    let lastChunk = void 0;
    let rowCount = 0;
    let skipped = 0;
    const emitLastChunk = onPage && (() => {
      lastChunk && onPage({
        pathInSchema,
        columnData: lastChunk,
        rowStart: groupStart + rowCount - lastChunk.length,
        rowEnd: groupStart + rowCount
      });
    });
    while (isFlat ? rowCount < selectEnd : reader.offset < reader.view.byteLength - 1) {
      if (reader.offset >= reader.view.byteLength - 1) break;
      const header = parquetHeader(reader);
      if (header.type === "DICTIONARY_PAGE") {
        const { data } = readPage(reader, header, columnDecoder, dictionary, void 0, 0);
        if (data) dictionary = convert(data, columnDecoder);
      } else {
        const lastChunkLength = (lastChunk == null ? void 0 : lastChunk.length) || 0;
        const result = readPage(reader, header, columnDecoder, dictionary, lastChunk, selectStart - rowCount);
        if (result.skipped) {
          if (!chunks.length) {
            skipped += result.skipped;
          }
          rowCount += result.skipped;
        } else if (result.data && lastChunk === result.data) {
          rowCount += result.data.length - lastChunkLength;
        } else if (result.data && result.data.length) {
          emitLastChunk == null ? void 0 : emitLastChunk();
          chunks.push(result.data);
          rowCount += result.data.length;
          lastChunk = result.data;
        }
      }
    }
    emitLastChunk == null ? void 0 : emitLastChunk();
    return { data: chunks, skipped };
  }
  function readPage(reader, header, columnDecoder, dictionary, previousChunk, pageStart) {
    const { type, element, schemaPath, codec, compressors: compressors2 } = columnDecoder;
    const compressedBytes = new Uint8Array(
      reader.view.buffer,
      reader.view.byteOffset + reader.offset,
      header.compressed_page_size
    );
    reader.offset += header.compressed_page_size;
    if (header.type === "DATA_PAGE") {
      const daph = header.data_page_header;
      if (!daph) throw new Error("parquet data page header is undefined");
      if (pageStart > daph.num_values && isFlatColumn(schemaPath)) {
        return { skipped: daph.num_values };
      }
      const page = decompressPage(compressedBytes, Number(header.uncompressed_page_size), codec, compressors2);
      const { definitionLevels, repetitionLevels, dataPage } = readDataPage(page, daph, columnDecoder);
      const values = convertWithDictionary(dataPage, dictionary, daph.encoding, columnDecoder);
      const output = Array.isArray(previousChunk) ? previousChunk : [];
      const assembled = assembleLists(output, definitionLevels, repetitionLevels, values, schemaPath);
      return { skipped: 0, data: assembled };
    } else if (header.type === "DATA_PAGE_V2") {
      const daph2 = header.data_page_header_v2;
      if (!daph2) throw new Error("parquet data page header v2 is undefined");
      if (pageStart > daph2.num_rows) {
        return { skipped: daph2.num_values };
      }
      const { definitionLevels, repetitionLevels, dataPage } = readDataPageV2(compressedBytes, header, columnDecoder);
      const values = convertWithDictionary(dataPage, dictionary, daph2.encoding, columnDecoder);
      const output = Array.isArray(previousChunk) ? previousChunk : [];
      const assembled = assembleLists(output, definitionLevels, repetitionLevels, values, schemaPath);
      return { skipped: 0, data: assembled };
    } else if (header.type === "DICTIONARY_PAGE") {
      const diph = header.dictionary_page_header;
      if (!diph) throw new Error("parquet dictionary page header is undefined");
      const page = decompressPage(
        compressedBytes,
        Number(header.uncompressed_page_size),
        codec,
        compressors2
      );
      const reader2 = { view: new DataView(page.buffer, page.byteOffset, page.byteLength), offset: 0 };
      const dictArray = readPlain(reader2, type, diph.num_values, element.type_length);
      return { skipped: 0, data: dictArray };
    } else {
      throw new Error(`parquet unsupported page type: ${header.type}`);
    }
  }
  function parquetHeader(reader) {
    const header = deserializeTCompactProtocol(reader);
    const type = PageTypes[header.field_1];
    const uncompressed_page_size = header.field_2;
    const compressed_page_size = header.field_3;
    const crc = header.field_4;
    const data_page_header = header.field_5 && {
      num_values: header.field_5.field_1,
      encoding: Encodings[header.field_5.field_2],
      definition_level_encoding: Encodings[header.field_5.field_3],
      repetition_level_encoding: Encodings[header.field_5.field_4],
      statistics: header.field_5.field_5 && {
        max: header.field_5.field_5.field_1,
        min: header.field_5.field_5.field_2,
        null_count: header.field_5.field_5.field_3,
        distinct_count: header.field_5.field_5.field_4,
        max_value: header.field_5.field_5.field_5,
        min_value: header.field_5.field_5.field_6
      }
    };
    const index_page_header = header.field_6;
    const dictionary_page_header = header.field_7 && {
      num_values: header.field_7.field_1,
      encoding: Encodings[header.field_7.field_2],
      is_sorted: header.field_7.field_3
    };
    const data_page_header_v2 = header.field_8 && {
      num_values: header.field_8.field_1,
      num_nulls: header.field_8.field_2,
      num_rows: header.field_8.field_3,
      encoding: Encodings[header.field_8.field_4],
      definition_levels_byte_length: header.field_8.field_5,
      repetition_levels_byte_length: header.field_8.field_6,
      is_compressed: header.field_8.field_7 === void 0 ? true : header.field_8.field_7,
      // default true
      statistics: header.field_8.field_8
    };
    return {
      type,
      uncompressed_page_size,
      compressed_page_size,
      crc,
      data_page_header,
      index_page_header,
      dictionary_page_header,
      data_page_header_v2
    };
  }

  // node_modules/hyparquet/src/rowgroup.js
  function readRowGroup(options, { metadata }, groupPlan) {
    const asyncColumns = [];
    for (const chunk of groupPlan.chunks) {
      const { path_in_schema: pathInSchema } = chunk.columnMetadata;
      const schemaPath = getSchemaPath(metadata.schema, pathInSchema);
      const columnDecoder = {
        pathInSchema,
        element: schemaPath[schemaPath.length - 1].element,
        schemaPath,
        ...options,
        ...chunk.columnMetadata,
        // merge after options, so a partial parsers object keeps the defaults
        parsers: { ...DEFAULT_PARSERS, ...options.parsers }
      };
      const { startByte, endByte } = chunk.range;
      if ("pageLocations" in chunk) {
        asyncColumns.push({
          pathInSchema,
          data: readSelectedPages(options, groupPlan, chunk, chunk.pageLocations, columnDecoder)
        });
      } else if ("offsetIndex" in chunk) {
        asyncColumns.push({
          pathInSchema,
          // fetch offset index
          data: Promise.resolve(options.file.slice(chunk.offsetIndex.startByte, chunk.offsetIndex.endByte)).then((arrayBuffer) => {
            const pages = readOffsetIndex({ view: new DataView(arrayBuffer), offset: 0 }).page_locations;
            return readSelectedPages(options, groupPlan, chunk, pages, columnDecoder);
          })
        });
      } else {
        asyncColumns.push({
          pathInSchema,
          data: Promise.resolve(options.file.slice(startByte, endByte)).then((buffer) => {
            const reader = { view: new DataView(buffer), offset: 0 };
            return readColumn(reader, groupPlan, columnDecoder, options.onPage);
          })
        });
      }
    }
    return {
      groupStart: groupPlan.groupStart,
      groupRows: groupPlan.groupRows,
      selectStart: groupPlan.selectStart,
      selectEnd: groupPlan.selectEnd,
      asyncColumns
    };
  }
  async function readSelectedPages(options, groupPlan, chunk, pages, columnDecoder) {
    const { data_page_offset, dictionary_page_offset } = chunk.columnMetadata;
    const { selectStart, selectEnd } = groupPlan;
    let { startByte, endByte } = chunk.range;
    let skipped = -1;
    const hasDict = dictionary_page_offset || data_page_offset < pages[0].offset;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageStart = Number(page.first_row_index);
      const pageEnd = i + 1 < pages.length ? Number(pages[i + 1].first_row_index) : groupPlan.groupRows;
      if (skipped < 0 && pageEnd > selectStart) {
        startByte = Number(page.offset);
        skipped = pageStart;
      }
      if (pageStart < selectEnd) {
        endByte = Number(page.offset) + page.compressed_page_size;
      }
    }
    if (skipped < 0) skipped = 0;
    let view;
    if (hasDict && skipped) {
      const dictLength = Number(pages[0].offset) - chunk.range.startByte;
      const [dictBuffer, dataBuffer] = await Promise.all([
        options.file.slice(chunk.range.startByte, Number(pages[0].offset)),
        options.file.slice(startByte, endByte)
      ]);
      const combined = new Uint8Array(dictLength + dataBuffer.byteLength);
      combined.set(new Uint8Array(dictBuffer, 0, dictLength));
      combined.set(new Uint8Array(dataBuffer), dictLength);
      view = new DataView(combined.buffer);
    } else if (hasDict) {
      view = new DataView(await options.file.slice(chunk.range.startByte, endByte));
    } else {
      view = new DataView(await options.file.slice(startByte, endByte));
    }
    const reader = { view, offset: 0 };
    const adjustedGroupPlan = skipped ? {
      ...groupPlan,
      groupStart: groupPlan.groupStart + skipped,
      selectStart: groupPlan.selectStart - skipped,
      selectEnd: groupPlan.selectEnd - skipped
    } : groupPlan;
    const { data, skipped: columnSkipped } = readColumn(reader, adjustedGroupPlan, columnDecoder, options.onPage);
    return {
      data,
      skipped: skipped + columnSkipped
    };
  }
  async function asyncGroupToRows({ asyncColumns }, selectStart, selectEnd, columns, rowFormat) {
    const asyncPages = await Promise.all(asyncColumns.map(
      (column) => column.data.then(({ skipped, data }) => ({ skipped, data: flatten(data) }))
    ));
    const selectCount = selectEnd - selectStart;
    if (rowFormat === "object") {
      const groupData2 = Array(selectCount);
      for (let selectRow = 0; selectRow < selectCount; selectRow++) {
        const rowData = {};
        for (let i = 0; i < asyncColumns.length; i++) {
          const { data, skipped } = asyncPages[i];
          rowData[asyncColumns[i].pathInSchema[0]] = data[selectStart + selectRow - skipped];
        }
        groupData2[selectRow] = rowData;
      }
      return groupData2;
    }
    const includedColumnNames = asyncColumns.map((child) => child.pathInSchema[0]).filter((name) => !columns || columns.includes(name));
    const columnOrder = columns != null ? columns : includedColumnNames;
    const columnIndexes = columnOrder.map((name) => asyncColumns.findIndex((column) => column.pathInSchema[0] === name));
    const groupData = Array(selectCount);
    for (let selectRow = 0; selectRow < selectCount; selectRow++) {
      const rowData = Array(asyncColumns.length);
      for (let i = 0; i < columnOrder.length; i++) {
        const colIdx = columnIndexes[i];
        if (colIdx < 0) throw new Error(`parquet column not found: ${columnOrder[i]}`);
        const { data, skipped } = asyncPages[colIdx];
        rowData[i] = data[selectStart + selectRow - skipped];
      }
      groupData[selectRow] = rowData;
    }
    return groupData;
  }
  function assembleAsync(asyncRowGroup, schemaTree2, parsers) {
    const { asyncColumns } = asyncRowGroup;
    const allParsers = { ...DEFAULT_PARSERS, ...parsers };
    const assembled = [];
    for (const child of schemaTree2.children) {
      if (child.children.length) {
        const childColumns = asyncColumns.filter((column) => column.pathInSchema[0] === child.element.name);
        if (!childColumns.length) continue;
        assembled.push({
          pathInSchema: child.path,
          data: (async () => {
            var _a, _b;
            const resolved = await Promise.all(childColumns.map((c) => c.data));
            const subcolumnData = /* @__PURE__ */ new Map();
            const flattened = resolved.map(({ data }) => flatten(data));
            const skipped = Math.max((_a = asyncRowGroup.selectStart) != null ? _a : 0, ...resolved.map((result) => result.skipped));
            const end = Math.min((_b = asyncRowGroup.selectEnd) != null ? _b : Infinity, ...resolved.map((result, i) => result.skipped + flattened[i].length));
            for (let i = 0; i < childColumns.length; i++) {
              const start = skipped - resolved[i].skipped;
              const length = Math.max(0, end - skipped);
              subcolumnData.set(
                childColumns[i].pathInSchema.join("."),
                flattened[i].slice(start, start + length)
              );
            }
            assembleNested(subcolumnData, child, allParsers);
            const assembled2 = subcolumnData.get(child.element.name);
            if (!assembled2) throw new Error("parquet column data not assembled");
            return { data: [assembled2], skipped };
          })()
        });
      } else {
        const asyncColumn = asyncColumns.find((column) => column.pathInSchema[0] === child.element.name);
        if (asyncColumn) assembled.push(asyncColumn);
      }
    }
    return { ...asyncRowGroup, asyncColumns: assembled };
  }

  // node_modules/hyparquet/src/scan.js
  async function prepareParquetRead(options) {
    const prepared = await prepareParquetOptions(options);
    return {
      options: prepared,
      plan: parquetPlan(prepared)
    };
  }
  async function prepareParquetOptions(options) {
    var _a;
    const metadata = (_a = options.metadata) != null ? _a : await parquetMetadataAsync(options.file, options);
    const schemaColumns = parquetSchema(metadata).children.map((child) => child.element.name);
    const filterColumns = columnsNeededForFilter(options.filter);
    const missingFilterColumns = filterColumns.filter((column) => !schemaColumns.includes(column));
    if (missingFilterColumns.length) {
      throw new Error(`parquet filter columns not found: ${missingFilterColumns.join(", ")}`);
    }
    if (options.columns) {
      const missingColumns = options.columns.filter((column) => !schemaColumns.includes(column));
      if (missingColumns.length) throw new Error(`parquet column not found: ${missingColumns[0]}`);
    }
    let prepared = { ...options, metadata };
    prepared = await withBloomFilters(prepared);
    prepared = await withPageIndexes(prepared);
    return prepared;
  }
  function readParquetPlan(options, plan) {
    const readOptions = { ...options, file: prefetchAsyncBuffer(options.file, plan) };
    return plan.groups.map((group) => readRowGroup(readOptions, plan, group));
  }
  async function withBloomFilters(options) {
    if (!options.useBloomFilters || !options.filter || !options.metadata) return options;
    const schemaTree2 = parquetSchema(options.metadata);
    const schemaElements = {};
    for (const child of schemaTree2.children) schemaElements[child.element.name] = child.element;
    const bloomFiltersByGroup = await prefetchBloomFilters({
      file: options.file,
      metadata: options.metadata,
      filter: options.filter,
      filterStrict: options.filterStrict
    });
    return { ...options, bloomFiltersByGroup, schemaElements };
  }
  async function withPageIndexes(options) {
    if (!options.usePageIndex || !options.filter || !options.metadata) return options;
    const { pageRangesByGroup, pageLocationsByGroup } = await prefetchPageIndexes({
      file: options.file,
      metadata: options.metadata,
      filter: options.filter,
      filterStrict: options.filterStrict,
      rowStart: options.rowStart,
      rowEnd: options.rowEnd,
      columns: options.columns,
      bloomFiltersByGroup: options.bloomFiltersByGroup,
      schemaElements: options.schemaElements,
      parsers: options.parsers
    });
    return { ...options, pageRangesByGroup, pageLocationsByGroup };
  }

  // node_modules/hyparquet/src/read.js
  var rowIndex = (
    /** @type {typeof import('../src/types.js').rowIndex} */
    Symbol("rowIndex")
  );
  async function parquetRead(options) {
    var _a, _b, _c;
    (_a = options.metadata) != null ? _a : options.metadata = await parquetMetadataAsync(options.file, options);
    const { rowStart = 0, rowEnd, columns, onChunk, onComplete, rowFormat, filter, filterStrict = true } = options;
    if (filter && rowFormat !== "object") {
      throw new Error('parquet filter requires rowFormat: "object"');
    }
    if (options.includeRowIndex && rowFormat !== "object") {
      throw new Error('parquet includeRowIndex requires rowFormat: "object"');
    }
    const filterColumns = columnsNeededForFilter(filter);
    let readColumns = columns;
    if (columns && filterColumns.length) {
      const selectedColumns = new Set(columns);
      const extraColumns = filterColumns.filter((column) => !selectedColumns.has(column));
      if (extraColumns.length) readColumns = [...columns, ...extraColumns];
    }
    const readOptions = readColumns === columns ? options : { ...options, columns: readColumns };
    const prepared = await prepareParquetRead(readOptions);
    const preparedOptions = prepared.options;
    const requiresProjection = readColumns !== columns;
    const asyncGroups = readParquetPlan(preparedOptions, prepared.plan);
    if (!onComplete && !onChunk) {
      await awaitAllColumns(asyncGroups);
      return;
    }
    if (!preparedOptions.metadata) throw new Error("parquet requires metadata");
    const schemaTree2 = parquetSchema(preparedOptions.metadata);
    const assembled = asyncGroups.map((arg) => assembleAsync(arg, schemaTree2, options.parsers));
    if (onChunk) {
      for (const asyncGroup of assembled) {
        for (const asyncColumn of asyncGroup.asyncColumns) {
          asyncColumn.data.then(({ data, skipped }) => {
            let rowStart2 = asyncGroup.groupStart + skipped;
            for (const columnData of data) {
              onChunk({
                columnName: asyncColumn.pathInSchema[0],
                columnData,
                rowStart: rowStart2,
                rowEnd: rowStart2 + columnData.length
              });
              rowStart2 += columnData.length;
            }
          }, () => {
          });
        }
      }
    }
    if (onComplete) {
      await awaitAllColumns(assembled);
      const rows = [];
      for (const asyncGroup of assembled) {
        const selectStart = (_b = asyncGroup.selectStart) != null ? _b : Math.max(rowStart - asyncGroup.groupStart, 0);
        const selectEnd = (_c = asyncGroup.selectEnd) != null ? _c : Math.min((rowEnd != null ? rowEnd : Infinity) - asyncGroup.groupStart, asyncGroup.groupRows);
        const groupData = rowFormat === "object" ? await asyncGroupToRows(asyncGroup, selectStart, selectEnd, readColumns, "object") : await asyncGroupToRows(asyncGroup, selectStart, selectEnd, columns, "array");
        if (options.includeRowIndex) {
          for (let i = 0; i < groupData.length; i++) {
            Object.defineProperty(groupData[i], rowIndex, {
              value: asyncGroup.groupStart + selectStart + i
            });
          }
        }
        if (filter) {
          for (
            const row of
            /** @type {Record<string, any>[]} */
            groupData
          ) {
            if (matchFilter(row, filter, filterStrict)) {
              if (requiresProjection && columns) {
                for (const col of filterColumns) {
                  if (!columns.includes(col)) delete row[col];
                }
              }
              rows.push(row);
            }
          }
        } else {
          concat(rows, groupData);
        }
      }
      onComplete(rows);
    } else {
      await awaitAllColumns(assembled);
    }
  }
  async function awaitAllColumns(asyncGroups) {
    const all = asyncGroups.flatMap((g) => g.asyncColumns.map((c) => c.data));
    const results = await Promise.allSettled(all);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
  }
  function parquetReadObjects(options) {
    return new Promise((onComplete, reject) => {
      parquetRead({
        ...options,
        rowFormat: "object",
        // force object output
        onComplete
      }).catch(reject);
    });
  }

  // node_modules/fzstd/esm/index.mjs
  var ab = ArrayBuffer;
  var u8 = Uint8Array;
  var u16 = Uint16Array;
  var i16 = Int16Array;
  var i32 = Int32Array;
  var slc = function(v, s, e) {
    if (u8.prototype.slice)
      return u8.prototype.slice.call(v, s, e);
    if (s == null || s < 0)
      s = 0;
    if (e == null || e > v.length)
      e = v.length;
    var n = new u8(e - s);
    n.set(v.subarray(s, e));
    return n;
  };
  var fill = function(v, n, s, e) {
    if (u8.prototype.fill)
      return u8.prototype.fill.call(v, n, s, e);
    if (s == null || s < 0)
      s = 0;
    if (e == null || e > v.length)
      e = v.length;
    for (; s < e; ++s)
      v[s] = n;
    return v;
  };
  var cpw = function(v, t, s, e) {
    if (u8.prototype.copyWithin)
      return u8.prototype.copyWithin.call(v, t, s, e);
    if (s == null || s < 0)
      s = 0;
    if (e == null || e > v.length)
      e = v.length;
    while (s < e) {
      v[t++] = v[s++];
    }
  };
  var ec = [
    "invalid zstd data",
    "window size too large (>2046MB)",
    "invalid block type",
    "FSE accuracy too high",
    "match distance too far back",
    "unexpected EOF"
  ];
  var err = function(ind, msg, nt) {
    var e = new Error(msg || ec[ind]);
    e.code = ind;
    if (Error.captureStackTrace)
      Error.captureStackTrace(e, err);
    if (!nt)
      throw e;
    return e;
  };
  var rb = function(d, b, n) {
    var i = 0, o = 0;
    for (; i < n; ++i)
      o |= d[b++] << (i << 3);
    return o;
  };
  var b4 = function(d, b) {
    return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
  };
  var rzfh = function(dat, w) {
    var n3 = dat[0] | dat[1] << 8 | dat[2] << 16;
    if (n3 == 3126568 && dat[3] == 253) {
      var flg = dat[4];
      var ss = flg >> 5 & 1, cc = flg >> 2 & 1, df = flg & 3, fcf = flg >> 6;
      if (flg & 8)
        err(0);
      var bt = 6 - ss;
      var db = df == 3 ? 4 : df;
      var di = rb(dat, bt, db);
      bt += db;
      var fsb = fcf ? 1 << fcf : ss;
      var fss = rb(dat, bt, fsb) + (fcf == 1 && 256);
      var ws = fss;
      if (!ss) {
        var wb = 1 << 10 + (dat[5] >> 3);
        ws = wb + (wb >> 3) * (dat[5] & 7);
      }
      if (ws > 2145386496)
        err(1);
      var buf = new u8((w == 1 ? fss || ws : w ? 0 : ws) + 12);
      buf[0] = 1, buf[4] = 4, buf[8] = 8;
      return {
        b: bt + fsb,
        y: 0,
        l: 0,
        d: di,
        w: w && w != 1 ? w : buf.subarray(12),
        e: ws,
        o: new i32(buf.buffer, 0, 3),
        u: fss,
        c: cc,
        m: Math.min(131072, ws)
      };
    } else if ((n3 >> 4 | dat[3] << 20) == 25481893) {
      return b4(dat, 4) + 8;
    }
    err(0);
  };
  var msb = function(val) {
    var bits = 0;
    for (; 1 << bits <= val; ++bits)
      ;
    return bits - 1;
  };
  var rfse = function(dat, bt, mal) {
    var tpos = (bt << 3) + 4;
    var al = (dat[bt] & 15) + 5;
    if (al > mal)
      err(3);
    var sz = 1 << al;
    var probs = sz, sym = -1, re = -1, i = -1, ht = sz;
    var buf = new ab(512 + (sz << 2));
    var freq = new i16(buf, 0, 256);
    var dstate = new u16(buf, 0, 256);
    var nstate = new u16(buf, 512, sz);
    var bb1 = 512 + (sz << 1);
    var syms = new u8(buf, bb1, sz);
    var nbits = new u8(buf, bb1 + sz);
    while (sym < 255 && probs > 0) {
      var bits = msb(probs + 1);
      var cbt = tpos >> 3;
      var msk = (1 << bits + 1) - 1;
      var val = (dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (tpos & 7) & msk;
      var msk1fb = (1 << bits) - 1;
      var msv = msk - probs - 1;
      var sval = val & msk1fb;
      if (sval < msv)
        tpos += bits, val = sval;
      else {
        tpos += bits + 1;
        if (val > msk1fb)
          val -= msv;
      }
      freq[++sym] = --val;
      if (val == -1) {
        probs += val;
        syms[--ht] = sym;
      } else
        probs -= val;
      if (!val) {
        do {
          var rbt = tpos >> 3;
          re = (dat[rbt] | dat[rbt + 1] << 8) >> (tpos & 7) & 3;
          tpos += 2;
          sym += re;
        } while (re == 3);
      }
    }
    if (sym > 255 || probs)
      err(0);
    var sympos = 0;
    var sstep = (sz >> 1) + (sz >> 3) + 3;
    var smask = sz - 1;
    for (var s = 0; s <= sym; ++s) {
      var sf = freq[s];
      if (sf < 1) {
        dstate[s] = -sf;
        continue;
      }
      for (i = 0; i < sf; ++i) {
        syms[sympos] = s;
        do {
          sympos = sympos + sstep & smask;
        } while (sympos >= ht);
      }
    }
    if (sympos)
      err(0);
    for (i = 0; i < sz; ++i) {
      var ns = dstate[syms[i]]++;
      var nb = nbits[i] = al - msb(ns);
      nstate[i] = (ns << nb) - sz;
    }
    return [tpos + 7 >> 3, {
      b: al,
      s: syms,
      n: nbits,
      t: nstate
    }];
  };
  var rhu = function(dat, bt) {
    var i = 0, wc = -1;
    var buf = new u8(292), hb = dat[bt];
    var hw = buf.subarray(0, 256);
    var rc = buf.subarray(256, 268);
    var ri = new u16(buf.buffer, 268);
    if (hb < 128) {
      var _a = rfse(dat, bt + 1, 6), ebt = _a[0], fdt = _a[1];
      bt += hb;
      var epos = ebt << 3;
      var lb = dat[bt];
      if (!lb)
        err(0);
      var st1 = 0, st2 = 0, btr1 = fdt.b, btr2 = btr1;
      var fpos = (++bt << 3) - 8 + msb(lb);
      for (; ; ) {
        fpos -= btr1;
        if (fpos < epos)
          break;
        var cbt = fpos >> 3;
        st1 += (dat[cbt] | dat[cbt + 1] << 8) >> (fpos & 7) & (1 << btr1) - 1;
        hw[++wc] = fdt.s[st1];
        fpos -= btr2;
        if (fpos < epos)
          break;
        cbt = fpos >> 3;
        st2 += (dat[cbt] | dat[cbt + 1] << 8) >> (fpos & 7) & (1 << btr2) - 1;
        hw[++wc] = fdt.s[st2];
        btr1 = fdt.n[st1];
        st1 = fdt.t[st1];
        btr2 = fdt.n[st2];
        st2 = fdt.t[st2];
      }
      if (++wc > 255)
        err(0);
    } else {
      wc = hb - 127;
      for (; i < wc; i += 2) {
        var byte = dat[++bt];
        hw[i] = byte >> 4;
        hw[i + 1] = byte & 15;
      }
      ++bt;
    }
    var wes = 0;
    for (i = 0; i < wc; ++i) {
      var wt = hw[i];
      if (wt > 11)
        err(0);
      wes += wt && 1 << wt - 1;
    }
    var mb = msb(wes) + 1;
    var ts = 1 << mb;
    var rem = ts - wes;
    if (rem & rem - 1)
      err(0);
    hw[wc++] = msb(rem) + 1;
    for (i = 0; i < wc; ++i) {
      var wt = hw[i];
      ++rc[hw[i] = wt && mb + 1 - wt];
    }
    var hbuf = new u8(ts << 1);
    var syms = hbuf.subarray(0, ts), nb = hbuf.subarray(ts);
    ri[mb] = 0;
    for (i = mb; i > 0; --i) {
      var pv = ri[i];
      fill(nb, i, pv, ri[i - 1] = pv + rc[i] * (1 << mb - i));
    }
    if (ri[0] != ts)
      err(0);
    for (i = 0; i < wc; ++i) {
      var bits = hw[i];
      if (bits) {
        var code = ri[bits];
        fill(syms, i, code, ri[bits] = code + (1 << mb - bits));
      }
    }
    return [bt, {
      n: nb,
      b: mb,
      s: syms
    }];
  };
  var dllt = rfse(/* @__PURE__ */ new u8([
    81,
    16,
    99,
    140,
    49,
    198,
    24,
    99,
    12,
    33,
    196,
    24,
    99,
    102,
    102,
    134,
    70,
    146,
    4
  ]), 0, 6)[1];
  var dmlt = rfse(/* @__PURE__ */ new u8([
    33,
    20,
    196,
    24,
    99,
    140,
    33,
    132,
    16,
    66,
    8,
    33,
    132,
    16,
    66,
    8,
    33,
    68,
    68,
    68,
    68,
    68,
    68,
    68,
    68,
    36,
    9
  ]), 0, 6)[1];
  var doct = rfse(/* @__PURE__ */ new u8([
    32,
    132,
    16,
    66,
    102,
    70,
    68,
    68,
    68,
    68,
    36,
    73,
    2
  ]), 0, 5)[1];
  var b2bl = function(b, s) {
    var len = b.length, bl = new i32(len);
    for (var i = 0; i < len; ++i) {
      bl[i] = s;
      s += 1 << b[i];
    }
    return bl;
  };
  var llb = /* @__PURE__ */ new u8((/* @__PURE__ */ new i32([
    0,
    0,
    0,
    0,
    16843009,
    50528770,
    134678020,
    202050057,
    269422093
  ])).buffer, 0, 36);
  var llbl = /* @__PURE__ */ b2bl(llb, 0);
  var mlb = /* @__PURE__ */ new u8((/* @__PURE__ */ new i32([
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    16843009,
    50528770,
    117769220,
    185207048,
    252579084,
    16
  ])).buffer, 0, 53);
  var mlbl = /* @__PURE__ */ b2bl(mlb, 3);
  var dhu = function(dat, out, hu) {
    var len = dat.length, ss = out.length, lb = dat[len - 1], msk = (1 << hu.b) - 1, eb = -hu.b;
    if (!lb)
      err(0);
    var st = 0, btr = hu.b, pos = (len << 3) - 8 + msb(lb) - btr, i = -1;
    for (; pos > eb && i < ss; ) {
      var cbt = pos >> 3;
      var val = (dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (pos & 7);
      st = (st << btr | val) & msk;
      out[++i] = hu.s[st];
      pos -= btr = hu.n[st];
    }
    if (pos != eb || i + 1 != ss)
      err(0);
  };
  var dhu4 = function(dat, out, hu) {
    var bt = 6;
    var ss = out.length, sz1 = ss + 3 >> 2, sz2 = sz1 << 1, sz3 = sz1 + sz2;
    dhu(dat.subarray(bt, bt += dat[0] | dat[1] << 8), out.subarray(0, sz1), hu);
    dhu(dat.subarray(bt, bt += dat[2] | dat[3] << 8), out.subarray(sz1, sz2), hu);
    dhu(dat.subarray(bt, bt += dat[4] | dat[5] << 8), out.subarray(sz2, sz3), hu);
    dhu(dat.subarray(bt), out.subarray(sz3), hu);
  };
  var rzb = function(dat, st, out) {
    var _a;
    var bt = st.b;
    var b0 = dat[bt], btype = b0 >> 1 & 3;
    st.l = b0 & 1;
    var sz = b0 >> 3 | dat[bt + 1] << 5 | dat[bt + 2] << 13;
    var ebt = (bt += 3) + sz;
    if (btype == 1) {
      if (bt >= dat.length)
        return;
      st.b = bt + 1;
      if (out) {
        fill(out, dat[bt], st.y, st.y += sz);
        return out;
      }
      return fill(new u8(sz), dat[bt]);
    }
    if (ebt > dat.length)
      return;
    if (btype == 0) {
      st.b = ebt;
      if (out) {
        out.set(dat.subarray(bt, ebt), st.y);
        st.y += sz;
        return out;
      }
      return slc(dat, bt, ebt);
    }
    if (btype == 2) {
      var b3 = dat[bt], lbt = b3 & 3, sf = b3 >> 2 & 3;
      var lss = b3 >> 4, lcs = 0, s4 = 0;
      if (lbt < 2) {
        if (sf & 1)
          lss |= dat[++bt] << 4 | (sf & 2 && dat[++bt] << 12);
        else
          lss = b3 >> 3;
      } else {
        s4 = sf;
        if (sf < 2)
          lss |= (dat[++bt] & 63) << 4, lcs = dat[bt] >> 6 | dat[++bt] << 2;
        else if (sf == 2)
          lss |= dat[++bt] << 4 | (dat[++bt] & 3) << 12, lcs = dat[bt] >> 2 | dat[++bt] << 6;
        else
          lss |= dat[++bt] << 4 | (dat[++bt] & 63) << 12, lcs = dat[bt] >> 6 | dat[++bt] << 2 | dat[++bt] << 10;
      }
      ++bt;
      var buf = out ? out.subarray(st.y, st.y + st.m) : new u8(st.m);
      var spl = buf.length - lss;
      if (lbt == 0)
        buf.set(dat.subarray(bt, bt += lss), spl);
      else if (lbt == 1)
        fill(buf, dat[bt++], spl);
      else {
        var hu = st.h;
        if (lbt == 2) {
          var hud = rhu(dat, bt);
          lcs += bt - (bt = hud[0]);
          st.h = hu = hud[1];
        } else if (!hu)
          err(0);
        (s4 ? dhu4 : dhu)(dat.subarray(bt, bt += lcs), buf.subarray(spl), hu);
      }
      var ns = dat[bt++];
      if (ns) {
        if (ns == 255)
          ns = (dat[bt++] | dat[bt++] << 8) + 32512;
        else if (ns > 127)
          ns = ns - 128 << 8 | dat[bt++];
        var scm = dat[bt++];
        if (scm & 3)
          err(0);
        var dts = [dmlt, doct, dllt];
        for (var i = 2; i > -1; --i) {
          var md = scm >> (i << 1) + 2 & 3;
          if (md == 1) {
            var rbuf = new u8([0, 0, dat[bt++]]);
            dts[i] = {
              s: rbuf.subarray(2, 3),
              n: rbuf.subarray(0, 1),
              t: new u16(rbuf.buffer, 0, 1),
              b: 0
            };
          } else if (md == 2) {
            _a = rfse(dat, bt, 9 - (i & 1)), bt = _a[0], dts[i] = _a[1];
          } else if (md == 3) {
            if (!st.t)
              err(0);
            dts[i] = st.t[i];
          }
        }
        var _b = st.t = dts, mlt = _b[0], oct = _b[1], llt = _b[2];
        var lb = dat[ebt - 1];
        if (!lb)
          err(0);
        var spos = (ebt << 3) - 8 + msb(lb) - llt.b, cbt = spos >> 3, oubt = 0;
        var lst = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << llt.b) - 1;
        cbt = (spos -= oct.b) >> 3;
        var ost = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << oct.b) - 1;
        cbt = (spos -= mlt.b) >> 3;
        var mst = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << mlt.b) - 1;
        for (++ns; --ns; ) {
          var llc = llt.s[lst];
          var lbtr = llt.n[lst];
          var mlc = mlt.s[mst];
          var mbtr = mlt.n[mst];
          var ofc = oct.s[ost];
          var obtr = oct.n[ost];
          cbt = (spos -= ofc) >> 3;
          var ofp = 1 << ofc;
          var off = ofp + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16 | dat[cbt + 3] << 24) >>> (spos & 7) & ofp - 1);
          cbt = (spos -= mlb[mlc]) >> 3;
          var ml = mlbl[mlc] + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (spos & 7) & (1 << mlb[mlc]) - 1);
          cbt = (spos -= llb[llc]) >> 3;
          var ll = llbl[llc] + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (spos & 7) & (1 << llb[llc]) - 1);
          cbt = (spos -= lbtr) >> 3;
          lst = llt.t[lst] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << lbtr) - 1);
          cbt = (spos -= mbtr) >> 3;
          mst = mlt.t[mst] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << mbtr) - 1);
          cbt = (spos -= obtr) >> 3;
          ost = oct.t[ost] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << obtr) - 1);
          if (off > 3) {
            st.o[2] = st.o[1];
            st.o[1] = st.o[0];
            st.o[0] = off -= 3;
          } else {
            var idx = off - (ll != 0);
            if (idx) {
              off = idx == 3 ? st.o[0] - 1 : st.o[idx];
              if (idx > 1)
                st.o[2] = st.o[1];
              st.o[1] = st.o[0];
              st.o[0] = off;
            } else
              off = st.o[0];
          }
          for (var i = 0; i < ll; ++i) {
            buf[oubt + i] = buf[spl + i];
          }
          oubt += ll, spl += ll;
          var stin = oubt - off;
          if (stin < 0) {
            var len = -stin;
            var bs = st.e + stin;
            if (len > ml)
              len = ml;
            for (var i = 0; i < len; ++i) {
              buf[oubt + i] = st.w[bs + i];
            }
            oubt += len, ml -= len, stin = 0;
          }
          for (var i = 0; i < ml; ++i) {
            buf[oubt + i] = buf[stin + i];
          }
          oubt += ml;
        }
        if (oubt != spl) {
          while (spl < buf.length) {
            buf[oubt++] = buf[spl++];
          }
        } else
          oubt = buf.length;
        if (out)
          st.y += oubt;
        else
          buf = slc(buf, 0, oubt);
      } else if (out) {
        st.y += lss;
        if (spl) {
          for (var i = 0; i < lss; ++i) {
            buf[i] = buf[spl + i];
          }
        }
      } else if (spl)
        buf = slc(buf, spl);
      st.b = ebt;
      return buf;
    }
    err(2);
  };
  var cct = function(bufs, ol) {
    if (bufs.length == 1)
      return bufs[0];
    var buf = new u8(ol);
    for (var i = 0, b = 0; i < bufs.length; ++i) {
      var chk = bufs[i];
      buf.set(chk, b);
      b += chk.length;
    }
    return buf;
  };
  function decompress(dat, buf) {
    var bufs = [], nb = +!buf;
    var bt = 0, ol = 0;
    for (; dat.length; ) {
      var st = rzfh(dat, nb || buf);
      if (typeof st == "object") {
        if (nb) {
          buf = null;
          if (st.w.length == st.u) {
            bufs.push(buf = st.w);
            ol += st.u;
          }
        } else {
          bufs.push(buf);
          st.e = 0;
        }
        for (; !st.l; ) {
          var blk = rzb(dat, st, buf);
          if (!blk)
            err(5);
          if (buf)
            st.e = st.y;
          else {
            bufs.push(blk);
            ol += blk.length;
            cpw(st.w, 0, blk.length);
            st.w.set(blk, st.w.length - blk.length);
          }
        }
        bt = st.b + st.c * 4;
      } else
        bt = st;
      dat = dat.subarray(bt);
    }
    return cct(bufs, ol);
  }

  // entry.js
  var compressors = { ZSTD: (input, outputLength) => decompress(input, new Uint8Array(outputLength)) };
  return __toCommonJS(entry_exports);
})();
