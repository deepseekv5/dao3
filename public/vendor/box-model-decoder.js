var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../dao3 max/box3-local-engine/packages/mudb/stream/codec.js
var require_codec = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/stream/codec.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.encode = encode;
    exports.decode = decode;
    function utf8ToBytes(str) {
      let codePoint;
      const strLength = str.length;
      let leadSurrogate;
      const bytes = [];
      for (let i = 0; i < strLength; ++i) {
        codePoint = str.charCodeAt(i);
        if (codePoint > 55295 && codePoint < 57344) {
          if (!leadSurrogate) {
            if (codePoint > 56319) {
              bytes.push(239, 191, 189);
              continue;
            } else if (i + 1 === strLength) {
              bytes.push(239, 191, 189);
              continue;
            }
            leadSurrogate = codePoint;
            continue;
          }
          if (codePoint < 56320) {
            bytes.push(239, 191, 189);
            leadSurrogate = codePoint;
            continue;
          }
          codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
        } else if (leadSurrogate) {
          bytes.push(239, 191, 189);
        }
        leadSurrogate = void 0;
        if (codePoint < 128) {
          bytes.push(codePoint);
        } else if (codePoint < 2048) {
          bytes.push(codePoint >> 6 | 192, codePoint & 63 | 128);
        } else if (codePoint < 65536) {
          bytes.push(codePoint >> 12 | 224, codePoint >> 6 & 63 | 128, codePoint & 63 | 128);
        } else if (codePoint < 1114112) {
          bytes.push(codePoint >> 18 | 240, codePoint >> 12 & 63 | 128, codePoint >> 6 & 63 | 128, codePoint & 63 | 128);
        } else {
          throw new Error("mudb/stream: invalid code point");
        }
      }
      return bytes;
    }
    function encode(str) {
      return new Uint8Array(utf8ToBytes(str));
    }
    function decodeCodePointsArray(codePoints) {
      const MAX_ARGUMENTS_LENGTH = 4096;
      const len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints);
      }
      let res = "";
      let i = 0;
      while (i < len) {
        res += String.fromCharCode.apply(String, codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH));
      }
      return res;
    }
    function decode(bytes) {
      const { byteLength } = bytes;
      const res = [];
      let i = 0;
      while (i < byteLength) {
        const firstByte = bytes[i];
        let codePoint;
        let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
        if (i + bytesPerSequence <= byteLength) {
          let secondByte;
          let thirdByte;
          let fourthByte;
          let tempCodePoint;
          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 128) {
                codePoint = firstByte;
              }
              break;
            case 2:
              secondByte = bytes[i + 1];
              if ((secondByte & 192) === 128) {
                tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                if (tempCodePoint > 127) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 3:
              secondByte = bytes[i + 1];
              thirdByte = bytes[i + 2];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 4:
              secondByte = bytes[i + 1];
              thirdByte = bytes[i + 2];
              fourthByte = bytes[i + 3];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                  codePoint = tempCodePoint;
                }
              }
          }
        }
        if (codePoint == void 0) {
          codePoint = 65533;
          bytesPerSequence = 1;
        } else if (codePoint > 65535) {
          codePoint -= 65536;
          res.push(codePoint >>> 10 & 1023 | 55296);
          codePoint = 56320 | codePoint & 1023;
        }
        res.push(codePoint);
        i += bytesPerSequence;
      }
      return decodeCodePointsArray(res);
    }
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/stream/index.js
var require_stream = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/stream/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuReadStream = exports.MuWriteStream = exports.MuBuffer = exports.decodeUTF8 = exports.encodeUTF8 = void 0;
    exports.allocBuffer = allocBuffer;
    exports.freeBuffer = freeBuffer;
    var root = typeof self == "object" && self["Object"] == Object && self || typeof global == "object" && global["Object"] == Object && global;
    if (typeof root === "object" && "TextEncoder" in root) {
      const encoder = new TextEncoder();
      exports.encodeUTF8 = (str) => encoder.encode(str);
      const decoder = new TextDecoder();
      exports.decodeUTF8 = (bytes) => decoder.decode(bytes);
    } else {
      const codec = require_codec();
      exports.encodeUTF8 = codec.encode;
      exports.decodeUTF8 = codec.decode;
    }
    function ceilLog2(v_) {
      let v = v_ - 1;
      let r = v > 65535 ? 1 << 4 : 0;
      v >>>= r;
      let shift = v > 255 ? 1 << 3 : 0;
      v >>>= shift;
      r |= shift;
      shift = v > 15 ? 1 << 2 : 0;
      v >>>= shift;
      r |= shift;
      shift = v > 3 ? 1 << 1 : 0;
      v >>>= shift;
      r |= shift;
      return (r | v >> 1) + 1;
    }
    var MuBuffer = class {
      constructor(buffer) {
        this.buffer = buffer;
        this.dataView = new DataView(buffer);
        this.uint8 = new Uint8Array(buffer);
      }
    };
    exports.MuBuffer = MuBuffer;
    var bufferPool = new Array(31);
    for (let i = 0; i < 31; ++i) {
      bufferPool[i] = [];
    }
    function allocBuffer(size) {
      if (size > 1073741824 || size < 0) {
        throw new RangeError(`size out of range: ${size}`);
      }
      size = Math.max(2, size | 0);
      const b = ceilLog2(size);
      return bufferPool[b].pop() || new MuBuffer(new ArrayBuffer(1 << b));
    }
    function freeBuffer(buffer) {
      if (buffer.uint8.length > 0) {
        bufferPool[ceilLog2(buffer.uint8.length)].push(buffer);
      }
    }
    var LITTLE_ENDIAN = true;
    var MuWriteStream3 = class {
      constructor(capacity) {
        this.buffer = allocBuffer(capacity);
        this.offset = 0;
      }
      bytes() {
        return this.buffer.uint8.subarray(0, this.offset);
      }
      destroy() {
        freeBuffer(this.buffer);
      }
      grow(bytes) {
        const newSize = this.offset + bytes;
        const uint8 = this.buffer.uint8;
        if (uint8.length < newSize) {
          const buffer = allocBuffer(newSize);
          buffer.uint8.set(uint8);
          freeBuffer(this.buffer);
          this.buffer = buffer;
        }
      }
      writeInt8(x) {
        this.buffer.dataView.setInt8(this.offset, x);
        this.offset += 1;
      }
      writeInt16(x) {
        this.buffer.dataView.setInt16(this.offset, x, LITTLE_ENDIAN);
        this.offset += 2;
      }
      writeInt32(x) {
        this.buffer.dataView.setInt32(this.offset, x, LITTLE_ENDIAN);
        this.offset += 4;
      }
      writeUint8(x) {
        this.buffer.dataView.setUint8(this.offset, x);
        this.offset += 1;
      }
      writeUint16(x) {
        this.buffer.dataView.setUint16(this.offset, x, LITTLE_ENDIAN);
        this.offset += 2;
      }
      writeUint32(x) {
        this.buffer.dataView.setUint32(this.offset, x, LITTLE_ENDIAN);
        this.offset += 4;
      }
      writeFloat32(x) {
        this.buffer.dataView.setFloat32(this.offset, x, LITTLE_ENDIAN);
        this.offset += 4;
      }
      writeFloat64(x) {
        this.buffer.dataView.setFloat64(this.offset, x, LITTLE_ENDIAN);
        this.offset += 8;
      }
      writeVarint(x) {
        const x_ = x >>> 0;
        const bytes = this.buffer.uint8;
        let offset = this.offset;
        if (x_ < 128) {
          bytes[offset++] = x_;
        } else if (x_ < 16384) {
          bytes[offset++] = x_ & 127 | 128;
          bytes[offset++] = x_ >>> 7;
        } else if (x_ < 2097152) {
          bytes[offset++] = x_ & 127 | 128;
          bytes[offset++] = x_ >> 7 & 127 | 128;
          bytes[offset++] = x_ >>> 14;
        } else if (x_ < 268435456) {
          bytes[offset++] = x_ & 127 | 128;
          bytes[offset++] = x_ >> 7 & 127 | 128;
          bytes[offset++] = x_ >> 14 & 127 | 128;
          bytes[offset++] = x_ >>> 21;
        } else {
          bytes[offset++] = x_ & 127 | 128;
          bytes[offset++] = x_ >> 7 & 127 | 128;
          bytes[offset++] = x_ >> 14 & 127 | 128;
          bytes[offset++] = x_ >> 21 & 127 | 128;
          bytes[offset++] = x_ >>> 28;
        }
        this.offset = offset;
      }
      writeASCII(str) {
        const bytes = this.buffer.uint8;
        let ptr = this.offset;
        for (let i = 0; i < str.length; ++i) {
          bytes[ptr++] = str.charCodeAt(i);
        }
        this.offset = ptr;
      }
      writeString(str) {
        const bytes = (0, exports.encodeUTF8)(str);
        this.grow(5 + bytes.length);
        this.writeVarint(bytes.length);
        this.buffer.uint8.set(bytes, this.offset);
        this.offset += bytes.length;
      }
      writeUint8At(offset, x) {
        this.buffer.dataView.setUint8(offset, x);
      }
      writeUint32At(offset, x) {
        this.buffer.dataView.setUint32(offset, x, LITTLE_ENDIAN);
      }
    };
    exports.MuWriteStream = MuWriteStream3;
    var MuReadStream4 = class {
      constructor(data) {
        this.buffer = new MuBuffer(data.buffer);
        this.offset = data.byteOffset;
        this.length = data.byteLength + data.byteOffset;
      }
      bytes() {
        return this.buffer.uint8.subarray(this.offset, this.length);
      }
      checkBounds() {
        if (this.offset > this.length) {
          throw new Error("out of bounds");
        }
      }
      readInt8() {
        const offset = this.offset;
        this.offset += 1;
        this.checkBounds();
        return this.buffer.dataView.getInt8(offset);
      }
      readInt16() {
        const offset = this.offset;
        this.offset += 2;
        this.checkBounds();
        return this.buffer.dataView.getInt16(offset, LITTLE_ENDIAN);
      }
      readInt32() {
        const offset = this.offset;
        this.offset += 4;
        this.checkBounds();
        return this.buffer.dataView.getInt32(offset, LITTLE_ENDIAN);
      }
      readUint8() {
        const offset = this.offset;
        this.offset += 1;
        this.checkBounds();
        return this.buffer.dataView.getUint8(offset);
      }
      readUint16() {
        const offset = this.offset;
        this.offset += 2;
        this.checkBounds();
        return this.buffer.dataView.getUint16(offset, LITTLE_ENDIAN);
      }
      readUint32() {
        const offset = this.offset;
        this.offset += 4;
        this.checkBounds();
        return this.buffer.dataView.getUint32(offset, LITTLE_ENDIAN);
      }
      readFloat32() {
        const offset = this.offset;
        this.offset += 4;
        this.checkBounds();
        return this.buffer.dataView.getFloat32(offset, LITTLE_ENDIAN);
      }
      readFloat64() {
        const offset = this.offset;
        this.offset += 8;
        this.checkBounds();
        return this.buffer.dataView.getFloat64(offset, LITTLE_ENDIAN);
      }
      readVarint() {
        const bytes = this.buffer.uint8;
        let offset = this.offset;
        const x0 = bytes[offset++];
        if (x0 < 128) {
          this.offset = offset;
          this.checkBounds();
          return x0;
        }
        const x1 = bytes[offset++];
        if (x1 < 128) {
          this.offset = offset;
          this.checkBounds();
          return x0 & 127 | x1 << 7;
        }
        const x2 = bytes[offset++];
        if (x2 < 128) {
          this.offset = offset;
          this.checkBounds();
          return x0 & 127 | (x1 & 127) << 7 | x2 << 14;
        }
        const x3 = bytes[offset++];
        if (x3 < 128) {
          this.offset = offset;
          this.checkBounds();
          return x0 & 127 | (x1 & 127) << 7 | (x2 & 127) << 14 | x3 << 21;
        }
        const x4 = bytes[offset++];
        this.offset = offset;
        this.checkBounds();
        return (x0 & 127) + ((x1 & 127) << 7) + ((x2 & 127) << 14) + ((x3 & 127) << 21) + x4 * (1 << 28);
      }
      readASCII(length) {
        const head = this.offset;
        this.offset += length;
        this.checkBounds();
        let str = "";
        for (let i = head; i < this.offset; ++i) {
          str += String.fromCharCode(this.buffer.uint8[i]);
        }
        return str;
      }
      readString() {
        const byteLength = this.readVarint();
        const head = this.offset;
        this.offset += byteLength;
        this.checkBounds();
        const bytes = this.buffer.uint8.subarray(head, this.offset);
        return (0, exports.decodeUTF8)(bytes);
      }
      readUint8At(offset) {
        return this.buffer.dataView.getUint8(offset);
      }
    };
    exports.MuReadStream = MuReadStream4;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/void.js
var require_void = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/void.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuVoid = void 0;
    var MuVoid = class {
      constructor() {
        this.identity = void 0;
        this.muType = "void";
        this.json = {
          type: "void"
        };
      }
      alloc() {
      }
      free(_) {
      }
      equal(a, b) {
        return true;
      }
      clone(_) {
      }
      assign(d, s) {
      }
      diff(b, t, out) {
        return false;
      }
      patch(b, inp) {
      }
      toJSON(_) {
        return null;
      }
      fromJSON(_) {
        return;
      }
    };
    exports.MuVoid = MuVoid;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/boolean.js
var require_boolean = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/boolean.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuBoolean = void 0;
    var MuBoolean = class {
      constructor(identity) {
        this.muType = "boolean";
        this.identity = !!identity;
        this.json = {
          type: "boolean",
          identity: this.identity
        };
      }
      alloc() {
        return this.identity;
      }
      free(bool) {
      }
      equal(a, b) {
        return a === b;
      }
      clone(bool) {
        return bool;
      }
      assign(dst, src) {
        return src;
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(1);
          out.writeUint8(target ? 1 : 0);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        const result = inp.readUint8();
        if (result > 1) {
          throw new Error(`invalid value for boolean`);
        }
        return !!result;
      }
      toJSON(bool) {
        return bool;
      }
      fromJSON(x) {
        if (typeof x === "boolean") {
          return x;
        }
        return this.identity;
      }
    };
    exports.MuBoolean = MuBoolean;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/_string.js
var require_string = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/_string.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuString = void 0;
    var MuString = class {
      constructor(identity, type) {
        this.identity = identity;
        this.muType = type;
        this.json = {
          type,
          identity
        };
      }
      alloc() {
        return this.identity;
      }
      free(str) {
      }
      equal(a, b) {
        return a === b;
      }
      clone(str) {
        return str;
      }
      assign(dst, src) {
        return src;
      }
      toJSON(str) {
        return str;
      }
      fromJSON(x) {
        if (typeof x === "string") {
          return x;
        }
        return this.identity;
      }
    };
    exports.MuString = MuString;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/ascii.js
var require_ascii = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/ascii.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuASCII = void 0;
    var _string_1 = require_string();
    var MuASCII5 = class extends _string_1.MuString {
      constructor(identity) {
        super(identity || "", "ascii");
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(5 + target.length);
          out.writeVarint(target.length);
          out.writeASCII(target);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        return inp.readASCII(inp.readVarint());
      }
    };
    exports.MuASCII = MuASCII5;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/fixed-ascii.js
var require_fixed_ascii = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/fixed-ascii.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuFixedASCII = void 0;
    var _string_1 = require_string();
    var MuFixedASCII = class extends _string_1.MuString {
      constructor(lengthOrIdentity) {
        const identity = typeof lengthOrIdentity === "number" ? new Array(lengthOrIdentity + 1).join(" ") : lengthOrIdentity;
        super(identity, "fixed-ascii");
        this.length = identity.length;
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(this.length);
          out.writeASCII(target);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        return inp.readASCII(this.length);
      }
    };
    exports.MuFixedASCII = MuFixedASCII;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/utf8.js
var require_utf8 = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/utf8.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuUTF8 = void 0;
    var _string_1 = require_string();
    var MuUTF84 = class extends _string_1.MuString {
      constructor(identity) {
        super(identity || "", "utf8");
      }
      diff(base, target, stream) {
        if (base !== target) {
          stream.writeString(target);
          return true;
        }
        return false;
      }
      patch(base, stream) {
        return stream.readString();
      }
    };
    exports.MuUTF8 = MuUTF84;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/_number.js
var require_number = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/_number.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuNumber = exports.ranges = void 0;
    function tuple(...args) {
      return args;
    }
    exports.ranges = {
      float32: tuple(-34028234663852886e22, 34028234663852886e22),
      float64: tuple(-17976931348623157e292, 17976931348623157e292),
      int8: tuple(-128, 127),
      int16: tuple(-32768, 32767),
      int32: tuple(-2147483648, 2147483647),
      uint8: tuple(0, 255),
      uint16: tuple(0, 65535),
      uint32: tuple(0, 4294967295),
      varint: tuple(0, 4294967295),
      rvarint: tuple(0, 4294967295)
    };
    var MuNumber = class {
      constructor(identity_, type) {
        const identity = identity_ === identity_ ? identity_ || 0 : NaN;
        const range = exports.ranges[type];
        if (identity !== Infinity && identity !== -Infinity && identity === identity) {
          if (identity < range[0] || identity > range[1]) {
            throw new RangeError(`${identity} is out of range of ${type}`);
          }
        } else if (type !== "float32" && type !== "float64") {
          throw new RangeError(`${identity} is out of range of ${type}`);
        }
        this.identity = identity;
        this.muType = type;
        this.json = {
          type,
          identity
        };
      }
      alloc() {
        return this.identity;
      }
      free(num) {
      }
      equal(a, b) {
        return a === b;
      }
      clone(num) {
        return num;
      }
      assign(dst, src) {
        return src;
      }
      toJSON(num) {
        return num;
      }
      fromJSON(x) {
        if (typeof x === "number") {
          return x;
        }
        return this.identity;
      }
    };
    exports.MuNumber = MuNumber;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/float32.js
var require_float32 = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/float32.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuFloat32 = void 0;
    var _number_1 = require_number();
    var MuFloat325 = class extends _number_1.MuNumber {
      constructor(identity) {
        super(identity, "float32");
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(4);
          out.writeFloat32(target);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        return inp.readFloat32();
      }
    };
    exports.MuFloat32 = MuFloat325;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/float64.js
var require_float64 = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/float64.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuFloat64 = void 0;
    var _number_1 = require_number();
    var MuFloat64 = class extends _number_1.MuNumber {
      constructor(identity) {
        super(identity, "float64");
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(8);
          out.writeFloat64(target);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        return inp.readFloat64();
      }
    };
    exports.MuFloat64 = MuFloat64;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/int8.js
var require_int8 = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/int8.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuInt8 = void 0;
    var _number_1 = require_number();
    var MuInt8 = class extends _number_1.MuNumber {
      constructor(identity) {
        super(identity, "int8");
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(1);
          out.writeInt8(target);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        return inp.readInt8();
      }
    };
    exports.MuInt8 = MuInt8;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/int16.js
var require_int16 = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/int16.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuInt16 = void 0;
    var _number_1 = require_number();
    var MuInt16 = class extends _number_1.MuNumber {
      constructor(identity) {
        super(identity, "int16");
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(2);
          out.writeInt16(target);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        return inp.readInt16();
      }
    };
    exports.MuInt16 = MuInt16;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/int32.js
var require_int32 = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/int32.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuInt32 = void 0;
    var _number_1 = require_number();
    var MuInt324 = class extends _number_1.MuNumber {
      constructor(identity) {
        super(identity, "int32");
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(4);
          out.writeInt32(target);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        return inp.readInt32();
      }
    };
    exports.MuInt32 = MuInt324;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/uint8.js
var require_uint8 = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/uint8.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuUint8 = void 0;
    var _number_1 = require_number();
    var MuUint83 = class extends _number_1.MuNumber {
      constructor(identity) {
        super(identity, "uint8");
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(1);
          out.writeUint8(target);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        return inp.readUint8();
      }
    };
    exports.MuUint8 = MuUint83;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/uint16.js
var require_uint16 = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/uint16.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuUint16 = void 0;
    var _number_1 = require_number();
    var MuUint162 = class extends _number_1.MuNumber {
      constructor(identity) {
        super(identity, "uint16");
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(2);
          out.writeUint16(target);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        return inp.readUint16();
      }
    };
    exports.MuUint16 = MuUint162;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/uint32.js
var require_uint32 = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/uint32.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuUint32 = void 0;
    var _number_1 = require_number();
    var MuUint32 = class extends _number_1.MuNumber {
      constructor(identity) {
        super(identity, "uint32");
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(4);
          out.writeUint32(target);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        return inp.readUint32();
      }
    };
    exports.MuUint32 = MuUint32;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/varint.js
var require_varint = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/varint.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuVarint = void 0;
    var _number_1 = require_number();
    var MuVarint7 = class extends _number_1.MuNumber {
      constructor(identity) {
        super(identity, "varint");
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(5);
          out.writeVarint(target);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        return inp.readVarint();
      }
    };
    exports.MuVarint = MuVarint7;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/rvarint.js
var require_rvarint = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/rvarint.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuRelativeVarint = void 0;
    var _number_1 = require_number();
    var SCHROEPPEL2 = 2863311530;
    var MuRelativeVarint = class extends _number_1.MuNumber {
      constructor(identity) {
        super(identity, "rvarint");
      }
      diff(base, target, out) {
        if (base !== target) {
          out.grow(5);
          out.writeVarint(SCHROEPPEL2 + (target - base) ^ SCHROEPPEL2);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        const delta = (SCHROEPPEL2 ^ inp.readVarint()) - SCHROEPPEL2 >> 0;
        return base + delta;
      }
    };
    exports.MuRelativeVarint = MuRelativeVarint;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/quantized-float.js
var require_quantized_float = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/quantized-float.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuQuantizedFloat = void 0;
    var SCHROEPPEL2 = 2863311530;
    function readSchroeppel(stream) {
      const x = stream.readVarint();
      return (SCHROEPPEL2 ^ x) - SCHROEPPEL2 >> 0;
    }
    var MuQuantizedFloat = class {
      constructor(precision, identity) {
        this.precision = precision;
        this.invPrecision = 1;
        this.identity = 0;
        this.muData = {
          type: "quantized-float",
          precision: 0,
          identity: 0
        };
        this.muType = "quantized-float";
        this.invPrecision = 1 / this.precision;
        if (identity) {
          this.identity = this.precision * (this.invPrecision * identity >> 0);
        }
        this.json = this.muData = {
          type: "quantized-float",
          precision: this.precision,
          identity: this.identity
        };
      }
      assign(x, y) {
        return (this.invPrecision * y >> 0) * this.precision;
      }
      clone(y) {
        return (this.invPrecision * y >> 0) * this.precision;
      }
      alloc() {
        return this.identity;
      }
      free() {
      }
      toJSON(x) {
        return this.precision * (this.invPrecision * x >> 0);
      }
      fromJSON(x) {
        if (typeof x === "number") {
          return this.clone(x);
        }
        return this.identity;
      }
      equal(x, y) {
        const sf = this.invPrecision;
        return sf * x >> 0 === sf * y >> 0;
      }
      diff(base, target, stream) {
        const sf = this.invPrecision;
        const b = sf * base >> 0;
        const t = sf * target >> 0;
        if (b === t) {
          return false;
        }
        stream.grow(5);
        stream.writeVarint((SCHROEPPEL2 + (t - b) ^ SCHROEPPEL2) >>> 0);
        return true;
      }
      patch(base, stream) {
        const b = this.invPrecision * base >> 0;
        const d = readSchroeppel(stream);
        return (b + d) * this.precision;
      }
    };
    exports.MuQuantizedFloat = MuQuantizedFloat;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/is-primitive.js
var require_is_primitive = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/is-primitive.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isMuPrimitiveType = isMuPrimitiveType;
    var muPrimitiveTypes = [
      "ascii",
      "boolean",
      "fixed-ascii",
      "float32",
      "float64",
      "int8",
      "int16",
      "int32",
      "uint8",
      "uint16",
      "uint32",
      "utf8",
      "void"
    ];
    function isMuPrimitiveType(muType) {
      return muPrimitiveTypes.indexOf(muType) > -1;
    }
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/array.js
var require_array = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/array.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuArray = void 0;
    var is_primitive_1 = require_is_primitive();
    function assignPrimitive(dst, src) {
      const N = src.length;
      const M = dst.length;
      const L = Math.min(M, N);
      for (let i = 0; i < L; ++i) {
        dst[i] = src[i];
      }
      for (let i = M; i < N; ++i) {
        dst.push(src[i]);
      }
      dst.length = N;
      return dst;
    }
    function clonePrimitive(src) {
      this.allocCount += 1;
      return src.slice();
    }
    function equalPrimitive(a, b) {
      const N = a.length;
      const M = b.length;
      if (N !== M) {
        return false;
      }
      for (let i = 0; i < N; ++i) {
        if (a[i] !== b[i]) {
          return false;
        }
      }
      return true;
    }
    function toJSONPrimitive(a) {
      return a.slice();
    }
    function assignGeneric(schema) {
      return function(dst, src) {
        const N = src.length;
        const M = dst.length;
        const L = Math.min(M, N);
        for (let i = 0; i < L; ++i) {
          dst[i] = schema.assign(dst[i], src[i]);
        }
        for (let i = M; i < N; ++i) {
          dst.push(schema.clone(src[i]));
        }
        for (let i = N; i < M; ++i) {
          schema.free(dst[i]);
        }
        dst.length = N;
        return dst;
      };
    }
    function cloneGeneric(schema) {
      return function(src) {
        this.allocCount += 1;
        const result = src.slice();
        for (let i = 0; i < result.length; ++i) {
          result[i] = schema.clone(result[i]);
        }
        return result;
      };
    }
    function freeGeneric(schema) {
      return function(src) {
        this.freeCount += 1;
        for (let i = 0; i < src.length; ++i) {
          schema.free(src[i]);
        }
        src.length = 0;
      };
    }
    function equalGeneric(schema) {
      return function(a, b) {
        const N = a.length;
        const M = b.length;
        if (N !== M) {
          return false;
        }
        for (let i = 0; i < N; ++i) {
          if (!schema.equal(a[i], b[i])) {
            return false;
          }
        }
        return true;
      };
    }
    function toJSONGeneric(schema) {
      return function(arr) {
        const result = new Array(arr.length);
        for (let i = 0; i < arr.length; ++i) {
          result[i] = schema.toJSON(arr[i]);
        }
        return result;
      };
    }
    var MuArray9 = class {
      stats() {
        return {
          allocCount: this.allocCount,
          freeCount: this.freeCount,
          poolSize: 0
        };
      }
      constructor(schema, capacity, identity) {
        this.muType = "array";
        this.allocCount = 0;
        this.freeCount = 0;
        this.muData = schema;
        this.capacity = capacity;
        if (identity) {
          const copy = this.identity = identity.slice();
          for (let i = 0; i < copy.length; ++i) {
            copy[i] = schema.clone(copy[i]);
          }
        } else {
          this.identity = [];
        }
        this.json = {
          type: "array",
          valueType: schema.json,
          identity: JSON.stringify(this.identity)
        };
        if ((0, is_primitive_1.isMuPrimitiveType)(schema.muType)) {
          this.assign = assignPrimitive;
          this.clone = clonePrimitive;
          this.free = function(x) {
            this.freeCount += 1;
            x.length = 0;
          };
          this.equal = equalPrimitive;
          this.toJSON = toJSONPrimitive;
        } else {
          this.assign = assignGeneric(schema);
          this.clone = cloneGeneric(schema);
          this.free = freeGeneric(schema);
          this.equal = equalGeneric(schema);
          this.toJSON = toJSONGeneric(schema);
        }
      }
      alloc() {
        this.allocCount += 1;
        return [];
      }
      diff(base, target, out) {
        const tLeng = target.length;
        const numTrackers = Math.ceil(tLeng / 8);
        out.grow(4 + numTrackers);
        const head = out.offset;
        out.writeVarint(tLeng);
        let trackerOffset = out.offset;
        out.offset += numTrackers;
        let tracker = 0;
        let numPatches = 0;
        const bLeng = base.length;
        const schema = this.muData;
        for (let i = 0; i < Math.min(bLeng, tLeng); ++i) {
          if (schema.diff(base[i], target[i], out)) {
            tracker |= 1 << (i & 7);
            ++numPatches;
          }
          if ((i & 7) === 7) {
            out.writeUint8At(trackerOffset++, tracker);
            tracker = 0;
          }
        }
        for (let i = bLeng; i < tLeng; ++i) {
          if (schema.diff(schema.identity, target[i], out)) {
            tracker |= 1 << (i & 7);
            ++numPatches;
          }
          if ((i & 7) === 7) {
            out.writeUint8At(trackerOffset++, tracker);
            tracker = 0;
          }
        }
        if (tLeng & 7) {
          out.writeUint8At(trackerOffset, tracker);
        }
        if (numPatches > 0 || bLeng !== tLeng) {
          return true;
        }
        out.offset = head;
        return false;
      }
      patch(base, inp) {
        const tLeng = inp.readVarint();
        if (tLeng > this.capacity) {
          throw new RangeError(`target length ${tLeng} exceeds capacity ${this.capacity}`);
        }
        const bLeng = base.length;
        const L = Math.min(bLeng, tLeng);
        const numTrackers = Math.ceil(tLeng / 8);
        let trackerOffset = inp.offset;
        inp.offset += numTrackers;
        this.allocCount += 1;
        const result = base.slice();
        const schema = this.muData;
        result.length = L;
        let tracker = 0;
        for (let i = 0; i < L; ++i) {
          const mod8 = i & 7;
          if (!mod8) {
            tracker = inp.readUint8At(trackerOffset++);
          }
          if (1 << mod8 & tracker) {
            result[i] = schema.patch(base[i], inp);
          } else {
            result[i] = schema.clone(base[i]);
          }
        }
        for (let i = bLeng; i < tLeng; ++i) {
          const mod8 = i & 7;
          if (!mod8) {
            tracker = inp.readUint8At(trackerOffset++);
          }
          if (1 << mod8 & tracker) {
            result.push(schema.patch(schema.identity, inp));
          } else {
            result.push(schema.clone(schema.identity));
          }
        }
        return result;
      }
      fromJSON(x) {
        if (Array.isArray(x)) {
          const arr = new Array(x.length);
          const schema = this.muData;
          for (let i = 0; i < x.length; ++i) {
            arr[i] = schema.fromJSON(x[i]);
          }
          this.allocCount += 1;
          return arr;
        }
        return this.clone(this.identity);
      }
    };
    exports.MuArray = MuArray9;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/option.js
var require_option = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/option.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuOption = void 0;
    var TypeDiff;
    (function(TypeDiff2) {
      TypeDiff2[TypeDiff2["BECAME_UNDEFINED"] = 0] = "BECAME_UNDEFINED";
      TypeDiff2[TypeDiff2["BECAME_IDENTITY"] = 1] = "BECAME_IDENTITY";
      TypeDiff2[TypeDiff2["BECAME_DEFINED"] = 2] = "BECAME_DEFINED";
      TypeDiff2[TypeDiff2["STAYED_DEFINED"] = 3] = "STAYED_DEFINED";
    })(TypeDiff || (TypeDiff = {}));
    var MuOption = class {
      constructor(schema, identity, identityIsUndefined = false) {
        this.muType = "option";
        this.muData = schema;
        if (identityIsUndefined) {
          this.identity = void 0;
        } else {
          this.identity = identity !== void 0 ? schema.clone(identity) : schema.clone(schema.identity);
        }
        this.json = {
          type: "option",
          valueType: schema.json,
          identity: JSON.stringify(this.identity)
        };
      }
      alloc() {
        return this.muData.alloc();
      }
      free(val) {
        if (val === void 0) {
          return;
        }
        this.muData.free(val);
      }
      equal(a, b) {
        if (a === void 0 && b === void 0) {
          return true;
        }
        if (a !== void 0 && b === void 0) {
          return false;
        }
        if (a === void 0 && b !== void 0) {
          return false;
        }
        return this.muData.equal(a, b);
      }
      clone(val) {
        if (val === void 0) {
          return void 0;
        }
        return this.muData.clone(val);
      }
      assign(dst, src) {
        if (dst !== void 0 && src !== void 0) {
          return this.muData.assign(dst, src);
        }
        return src;
      }
      diff(base, target, out) {
        if (base === void 0 && target === void 0) {
          return false;
        }
        if (base === void 0 && target !== void 0) {
          out.grow(1);
          if (this.muData.equal(this.muData.identity, target)) {
            out.writeUint8(TypeDiff.BECAME_IDENTITY);
            return true;
          }
          out.writeUint8(TypeDiff.BECAME_DEFINED);
          this.muData.diff(this.muData.identity, target, out);
          return true;
        }
        if (base !== void 0 && target === void 0) {
          out.grow(1);
          out.writeUint8(TypeDiff.BECAME_UNDEFINED);
          return true;
        }
        if (this.muData.equal(base, target)) {
          return false;
        }
        out.grow(1);
        out.writeUint8(TypeDiff.STAYED_DEFINED);
        this.muData.diff(base, target, out);
        return true;
      }
      patch(base, inp) {
        const typeDiff = inp.readUint8();
        if (TypeDiff[typeDiff] === void 0) {
          throw new Error("Panic in muOption, invalid TypeDiff");
        }
        if (typeDiff == TypeDiff.BECAME_UNDEFINED) {
          return void 0;
        }
        if (typeDiff == TypeDiff.BECAME_DEFINED) {
          return this.muData.patch(this.muData.identity, inp);
        }
        if (typeDiff === TypeDiff.BECAME_IDENTITY) {
          return this.muData.clone(this.muData.identity);
        }
        if (typeDiff !== TypeDiff.STAYED_DEFINED || base === void 0) {
          throw new Error("Panic in muOption, invariants broken");
        }
        return this.muData.patch(base, inp);
      }
      toJSON(val) {
        if (val === void 0) {
          return void 0;
        }
        return this.muData.toJSON(val);
      }
      fromJSON(json) {
        if (json === void 0) {
          return void 0;
        }
        return this.muData.fromJSON(json);
      }
    };
    exports.MuOption = MuOption;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/sorted-array.js
var require_sorted_array = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/sorted-array.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuSortedArray = void 0;
    var array_1 = require_array();
    function defaultCompare(a, b) {
      if (a < b) {
        return -1;
      } else if (a > b) {
        return 1;
      } else {
        return 0;
      }
    }
    var SortedOp;
    (function(SortedOp2) {
      SortedOp2[SortedOp2["NONE"] = -1] = "NONE";
      SortedOp2[SortedOp2["SKIP"] = 0] = "SKIP";
      SortedOp2[SortedOp2["PATCH"] = 1] = "PATCH";
      SortedOp2[SortedOp2["INSERT"] = 2] = "INSERT";
      SortedOp2[SortedOp2["INSERT_IDENTITY"] = 3] = "INSERT_IDENTITY";
      SortedOp2[SortedOp2["COPY"] = 4] = "COPY";
    })(SortedOp || (SortedOp = {}));
    var MuSortedArray = class {
      stats() {
        return this._arraySchema.stats();
      }
      constructor(schema, capacity, compare, identity) {
        this.muType = "sorted-array";
        this.muData = schema;
        this.capacity = capacity;
        this.compare = compare || defaultCompare;
        const arraySchema = this._arraySchema = new array_1.MuArray(schema, capacity, identity);
        this.identity = arraySchema.identity.sort(this.compare);
        this.json = {
          type: "sorted-array",
          valueType: schema.json,
          identity: JSON.stringify(this.identity)
        };
        this.alloc = arraySchema.alloc;
        this.free = arraySchema.free;
        this.equal = arraySchema.equal;
        this.clone = arraySchema.clone;
        this.assign = arraySchema.assign;
        this.toJSON = arraySchema.toJSON;
        this.fromJSON = arraySchema.fromJSON;
      }
      diff(base, target, out) {
        if (base.length === 0 && target.length === 0) {
          return false;
        }
        const schema = this.muData;
        const compare = this.compare;
        out.grow(8);
        const head = out.offset;
        let opPtr = head;
        let opCount = 0;
        let opCode = SortedOp.NONE;
        out.offset += 4;
        let numOps = 0;
        function emitOp() {
          if (opCount > 0) {
            out.writeUint32At(opPtr, opCount << 3 | opCode);
            numOps++;
          }
          out.grow(4);
          opPtr = out.offset;
          out.offset += 4;
        }
        let basePtr = 0;
        let targetPtr = 0;
        while (basePtr < base.length && targetPtr < target.length) {
          const baseItem = base[basePtr];
          const targetItem = target[targetPtr];
          const cmp = compare(baseItem, targetItem);
          if (cmp < 0) {
            if (opCode !== SortedOp.SKIP) {
              emitOp();
              opCount = 1;
              opCode = SortedOp.SKIP;
            } else {
              opCount++;
            }
            basePtr++;
          } else if (0 < cmp) {
            if (opCode === SortedOp.INSERT) {
              if (schema.diff(schema.identity, targetItem, out)) {
                opCount++;
              } else {
                emitOp();
                opCode = SortedOp.INSERT_IDENTITY;
                opCount = 1;
              }
            } else if (opCode === SortedOp.INSERT_IDENTITY) {
              const prevOffset = out.offset;
              out.grow(4);
              out.offset += 4;
              if (schema.diff(schema.identity, targetItem, out)) {
                emitOp();
                out.offset -= 4;
                opPtr = prevOffset;
                opCode = SortedOp.INSERT;
                opCount = 1;
              } else {
                out.offset -= 4;
                opCount += 1;
              }
            } else {
              emitOp();
              opCount = 1;
              if (schema.diff(schema.identity, targetItem, out)) {
                opCode = SortedOp.INSERT;
              } else {
                opCode = SortedOp.INSERT_IDENTITY;
              }
            }
            targetPtr++;
          } else {
            if (opCode === SortedOp.PATCH) {
              if (schema.diff(baseItem, targetItem, out)) {
                opCount++;
              } else {
                emitOp();
                opCode = SortedOp.COPY;
                opCount = 1;
              }
            } else if (opCode === SortedOp.COPY) {
              const prevOffset = out.offset;
              out.grow(4);
              out.offset += 4;
              if (schema.diff(baseItem, targetItem, out)) {
                emitOp();
                out.offset -= 4;
                opPtr = prevOffset;
                opCode = SortedOp.PATCH;
                opCount = 1;
              } else {
                out.offset -= 4;
                opCount += 1;
              }
            } else {
              emitOp();
              opCount = 1;
              if (schema.diff(baseItem, targetItem, out)) {
                opCode = SortedOp.PATCH;
              } else {
                opCode = SortedOp.COPY;
              }
            }
            basePtr++;
            targetPtr++;
          }
        }
        if (basePtr < base.length) {
          if (opCode !== SortedOp.SKIP) {
            emitOp();
            opCount = base.length - basePtr;
            opCode = SortedOp.SKIP;
          } else {
            opCount += base.length - basePtr;
          }
          basePtr++;
        }
        while (targetPtr < target.length) {
          const targetItem = target[targetPtr];
          if (opCode === SortedOp.INSERT) {
            if (schema.diff(schema.identity, targetItem, out)) {
              opCount++;
            } else {
              emitOp();
              opCode = SortedOp.INSERT_IDENTITY;
              opCount = 1;
            }
          } else if (opCode === SortedOp.INSERT_IDENTITY) {
            const prevOffset = out.offset;
            out.grow(4);
            out.offset += 4;
            if (schema.diff(schema.identity, targetItem, out)) {
              emitOp();
              out.offset -= 4;
              opPtr = prevOffset;
              opCode = SortedOp.INSERT;
              opCount = 1;
            } else {
              out.offset -= 4;
              opCount += 1;
            }
          } else {
            emitOp();
            opCount = 1;
            if (schema.diff(schema.identity, targetItem, out)) {
              opCode = SortedOp.INSERT;
            } else {
              opCode = SortedOp.INSERT_IDENTITY;
            }
          }
          targetPtr++;
        }
        if (numOps === 0 && opCode === SortedOp.COPY && opCount === base.length) {
          out.offset = head;
          return false;
        }
        if (opCode !== SortedOp.SKIP) {
          emitOp();
        }
        out.offset -= 4;
        out.writeUint32At(head, numOps);
        return true;
      }
      patch(base, inp) {
        this._arraySchema.allocCount += 1;
        const schema = this.muData;
        const result = this.alloc();
        const numOps = inp.readUint32();
        let ptr = 0;
        let tLength = 0;
        for (let i = 0; i < numOps; ++i) {
          const code = inp.readUint32();
          const count = code >> 3;
          tLength += count;
          if (tLength > this.capacity) {
            throw new RangeError(`target length exceeds capacity ${this.capacity}`);
          }
          const op = code & 7;
          switch (op) {
            case SortedOp.INSERT_IDENTITY:
              for (let j = 0; j < count; ++j) {
                result.push(schema.clone(schema.identity));
              }
              break;
            case SortedOp.INSERT:
              for (let j = 0; j < count; ++j) {
                result.push(schema.patch(schema.identity, inp));
              }
              break;
            case SortedOp.PATCH:
              for (let j = 0; j < count; ++j) {
                result.push(schema.patch(base[ptr++], inp));
              }
              break;
            case SortedOp.COPY:
              for (let j = 0; j < count; ++j) {
                result.push(schema.clone(base[ptr++]));
              }
              break;
            case SortedOp.SKIP:
              ptr += count;
              break;
          }
        }
        return result;
      }
    };
    exports.MuSortedArray = MuSortedArray;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/struct.js
var require_struct = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/struct.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuStruct = void 0;
    var muPrimitiveSize = {
      boolean: 0,
      uint8: 1,
      uint16: 2,
      uint32: 4,
      int8: 1,
      int16: 2,
      int32: 4,
      float32: 4,
      float64: 8,
      varint: 5,
      rvarint: 5,
      "quantized-float": 5
    };
    var muType2ReadMethod = {
      boolean: "readUint8",
      float32: "readFloat32",
      float64: "readFloat64",
      int8: "readInt8",
      int16: "readInt16",
      int32: "readInt32",
      uint8: "readUint8",
      uint16: "readUint16",
      uint32: "readUint32",
      utf8: "readString",
      varint: "readVarint"
    };
    var muType2WriteMethod = {
      boolean: "writeUint8",
      float32: "writeFloat32",
      float64: "writeFloat64",
      int8: "writeInt8",
      int16: "writeInt16",
      int32: "writeInt32",
      uint8: "writeUint8",
      uint16: "writeUint16",
      uint32: "writeUint32",
      utf8: "writeString",
      varint: "writeVarint"
    };
    var muPrimitiveTypes = Object.keys(muPrimitiveSize);
    var MuStruct9 = class {
      constructor(spec) {
        this.muType = "struct";
        const props = Object.keys(spec).sort((a, b) => {
          const ai = muPrimitiveTypes.indexOf(spec[a].muType);
          const bi = muPrimitiveTypes.indexOf(spec[b].muType);
          return bi - ai || (a < b ? -1 : b < a ? 1 : 0);
        });
        const types = props.map((prop) => spec[prop]);
        const json = {
          type: "struct",
          subTypes: {}
        };
        props.forEach((prop) => {
          json.subTypes[prop] = spec[prop].json;
        });
        const params = [];
        const args = [];
        let tokenCounter = 0;
        function token() {
          return "_v" + ++tokenCounter;
        }
        function inject(arg) {
          for (let i = 0; i < args.length; ++i) {
            if (args[i] === arg) {
              return params[i];
            }
          }
          const param = token();
          params.push(param);
          args.push(arg);
          return param;
        }
        const propRefs = props.map(inject);
        const typeRefs = types.map(inject);
        function block() {
          const vars = [];
          const body = [];
          return {
            vars,
            body,
            toString() {
              const localVars = vars.length > 0 ? `var ${vars.join()};` : "";
              return localVars + body.join("");
            },
            def(value) {
              const tok = token();
              vars.push(tok);
              if (value != void 0) {
                body.push(`${tok}=${value};`);
              }
              return tok;
            },
            append(...code) {
              body.push.apply(body, code);
            }
          };
        }
        const prolog = block();
        const epilog = block();
        function func(name, params_) {
          const b = block();
          const baseToString = b.toString;
          b.toString = function() {
            return `function ${name}(${params_.join()}){${baseToString()}}`;
          };
          return b;
        }
        const methods = {
          alloc: func("alloc", []),
          free: func("free", ["s"]),
          equal: func("equal", ["a", "b"]),
          clone: func("clone", ["s"]),
          assign: func("assign", ["d", "s"]),
          diff: func("diff", ["b", "t", "s"]),
          patch: func("patch", ["b", "s"]),
          toJSON: func("toJSON", ["s"]),
          fromJSON: func("fromJSON", ["j"]),
          stats: func("stats", [])
        };
        const allocCountRef = prolog.def("-1");
        const freeCountRef = prolog.def("0");
        const poolRef = prolog.def("[]");
        prolog.append("function MuStruct(){");
        propRefs.forEach((pr, i) => {
          const type = types[i];
          switch (type.muType) {
            case "boolean":
            case "int8":
            case "int16":
            case "int32":
            case "uint8":
            case "uint16":
            case "uint32":
            case "varint":
            case "rvarint":
              prolog.append(`this[${pr}]=${type.identity};`);
              break;
            case "float32":
            case "float64":
            case "quantized-float":
              prolog.append(`this[${pr}]=0.5;this[${pr}]=${type.identity};`);
              break;
            case "ascii":
            case "fixed-ascii":
            case "utf8":
              prolog.append(`this[${pr}]=${inject(type.identity)};`);
              break;
            default:
              prolog.append(`this[${pr}]=null;`);
          }
        });
        prolog.append(`}function _alloc(){++${allocCountRef};if(${poolRef}.length>0){return ${poolRef}.pop()}return new MuStruct()}`);
        const identityRef = prolog.def("_alloc()");
        propRefs.forEach((pr, i) => {
          const type = types[i];
          switch (type.muType) {
            case "ascii":
            case "fixed-ascii":
            case "utf8":
            case "boolean":
            case "float32":
            case "float64":
            case "int8":
            case "int16":
            case "int32":
            case "uint8":
            case "uint16":
            case "uint32":
            case "varint":
            case "rvarint":
            case "quantized-float":
              break;
            default:
              prolog.append(`${identityRef}[${pr}]=${typeRefs[i]}.clone(${inject(type.identity)});`);
              break;
          }
        });
        methods.alloc.append(`var s=_alloc();`);
        propRefs.forEach((pr, i) => {
          const type = types[i];
          switch (type.muType) {
            case "ascii":
            case "fixed-ascii":
            case "utf8":
            case "boolean":
            case "float32":
            case "float64":
            case "int8":
            case "int16":
            case "int32":
            case "uint8":
            case "uint16":
            case "uint32":
            case "varint":
            case "rvarint":
            case "quantized-float":
              break;
            default:
              methods.alloc.append(`s[${pr}]=${typeRefs[i]}.alloc();`);
              break;
          }
        });
        methods.alloc.append(`return s;`);
        methods.free.append(`${poolRef}.push(s);`);
        propRefs.forEach((pr, i) => {
          const type = types[i];
          switch (type.muType) {
            case "ascii":
            case "fixed-ascii":
            case "utf8":
            case "boolean":
            case "float32":
            case "float64":
            case "int8":
            case "int16":
            case "int32":
            case "uint8":
            case "uint16":
            case "uint32":
            case "varint":
            case "rvarint":
            case "quantized-float":
              break;
            default:
              methods.free.append(`${typeRefs[i]}.free(s[${pr}]);`);
              break;
          }
        });
        methods.free.append(`++${freeCountRef};`);
        propRefs.forEach((pr, i) => {
          const type = types[i];
          switch (type.muType) {
            case "ascii":
            case "fixed-ascii":
            case "utf8":
            case "boolean":
            case "float32":
            case "float64":
            case "int8":
            case "int16":
            case "int32":
            case "uint8":
            case "uint16":
            case "uint32":
            case "varint":
            case "rvarint":
              methods.equal.append(`if(a[${pr}]!==b[${pr}]){return false}`);
              break;
            case "quantized-float":
              methods.equal.append(`if(((${type.invPrecision}*a[${pr}])>>0)!==((${type.invPrecision}*b[${pr}])>>0)){return false}`);
              break;
            default:
              methods.equal.append(`if(!${typeRefs[i]}.equal(a[${pr}],b[${pr}])){return false}`);
          }
        });
        methods.equal.append(`return true;`);
        methods.clone.append(`var c=_alloc();`);
        propRefs.forEach((pr, i) => {
          const type = types[i];
          switch (type.muType) {
            case "ascii":
            case "fixed-ascii":
            case "utf8":
            case "boolean":
            case "float32":
            case "float64":
            case "int8":
            case "int16":
            case "int32":
            case "uint8":
            case "uint16":
            case "uint32":
            case "varint":
            case "rvarint":
              methods.clone.append(`c[${pr}]=s[${pr}];`);
              break;
            case "quantized-float":
              methods.clone.append(`c[${pr}]=((${type.invPrecision}*s[${pr}])>>0)*${type.precision};`);
              break;
            default:
              methods.clone.append(`c[${pr}]=${typeRefs[i]}.clone(s[${pr}]);`);
              break;
          }
        });
        methods.clone.append("return c;");
        propRefs.forEach((pr, i) => {
          const type = types[i];
          switch (type.muType) {
            case "ascii":
            case "fixed-ascii":
            case "utf8":
            case "boolean":
            case "float32":
            case "float64":
            case "int8":
            case "int16":
            case "int32":
            case "uint8":
            case "uint16":
            case "uint32":
            case "varint":
            case "rvarint":
              methods.assign.append(`d[${pr}]=s[${pr}];`);
              break;
            case "quantized-float":
              methods.assign.append(`d[${pr}]=((${type.invPrecision}*s[${pr}])>>0)*${type.precision};`);
              break;
            default:
              methods.assign.append(`d[${pr}]=${typeRefs[i]}.assign(d[${pr}],s[${pr}]);`);
          }
        });
        methods.assign.append("return d;");
        const numProps = props.length;
        const trackerBytes = Math.ceil(numProps / 8);
        let baseSize = trackerBytes;
        for (let i = 0; i < types.length; ++i) {
          const muType = types[i].muType;
          if (muType in muPrimitiveSize) {
            baseSize += muPrimitiveSize[muType];
          }
        }
        methods.diff.append(`var head=s.offset;var tr=0;var np=0;s.grow(${baseSize});s.offset+=${trackerBytes};`);
        propRefs.forEach((pr, i) => {
          const muType = types[i].muType;
          switch (muType) {
            case "boolean":
              methods.diff.append(`if(b[${pr}]!==t[${pr}]){++np;tr|=${1 << (i & 7)}}`);
              break;
            case "float32":
            case "float64":
            case "int8":
            case "int16":
            case "int32":
            case "uint8":
            case "uint16":
            case "uint32":
            case "varint":
            case "utf8":
              methods.diff.append(`if(b[${pr}]!==t[${pr}]){s.${muType2WriteMethod[muType]}(t[${pr}]);++np;tr|=${1 << (i & 7)}}`);
              break;
            case "rvarint":
              methods.diff.append(`if(b[${pr}]!==t[${pr}]){s.writeVarint(0xAAAAAAAA+(t[${pr}]-b[${pr}])^0xAAAAAAAA);++np;tr|=${1 << (i & 7)}}`);
              break;
            case "ascii":
              methods.diff.append(`if(b[${pr}]!==t[${pr}]){s.grow(5+t[${pr}].length);s.writeVarint(t[${pr}].length);s.writeASCII(t[${pr}]);++np;tr|=${1 << (i & 7)}}`);
              break;
            case "quantized-float":
              const br = methods.diff.def(`(${types[i].invPrecision}*b[${pr}])>>0`);
              const tr = methods.diff.def(`(${types[i].invPrecision}*t[${pr}])>>0`);
              methods.diff.append(`if(${br}!==${tr}){s.writeVarint((0xAAAAAAAA+(${tr}-${br})^0xAAAAAAAA)>>>0);++np;tr|=${1 << (i & 7)};}`);
              break;
            default:
              methods.diff.append(`if(${typeRefs[i]}.diff(b[${pr}],t[${pr}],s)){++np;tr|=${1 << (i & 7)}}`);
          }
          if ((i & 7) === 7) {
            methods.diff.append(`s.writeUint8At(head+${i >> 3},tr);tr=0;`);
          }
        });
        if (numProps & 7) {
          methods.diff.append(`s.writeUint8At(head+${trackerBytes - 1},tr);`);
        }
        methods.diff.append(`if(np){return true}else{s.offset=head;return false}`);
        methods.patch.append(`var t=_alloc(b);var head=s.offset;var tr=0;s.offset+=${trackerBytes};`);
        propRefs.forEach((pr, i) => {
          if (!(i & 7)) {
            methods.patch.append(`tr=s.readUint8At(head+${i >> 3});`);
          }
          const type = types[i];
          const muType = type.muType;
          methods.patch.append(`;t[${pr}]=(tr&${1 << (i & 7)})?`);
          switch (muType) {
            case "boolean":
              methods.patch.append(`!b[${pr}]:b[${pr}];`);
              break;
            case "float32":
            case "float64":
            case "int8":
            case "int16":
            case "int32":
            case "uint8":
            case "uint16":
            case "uint32":
            case "utf8":
            case "varint":
              methods.patch.append(`s.${muType2ReadMethod[muType]}():b[${pr}];`);
              break;
            case "rvarint":
              methods.patch.append(`b[${pr}]+((0xAAAAAAAA^s.readVarint())-0xAAAAAAAA>>0):b[${pr}];`);
              break;
            case "ascii":
              methods.patch.append(`s.readASCII(s.readVarint()):b[${pr}];`);
              break;
            case "quantized-float":
              methods.patch.append(`(((${type.invPrecision}*b[${pr}])>>0)+(((0xAAAAAAAA^s.readVarint())-0xAAAAAAAA)>>0))*${type.precision}:b[${pr}];`);
              break;
            default:
              methods.patch.append(`${typeRefs[i]}.patch(b[${pr}],s):${typeRefs[i]}.clone(b[${pr}]);`);
          }
        });
        methods.patch.append(`return t;`);
        methods.toJSON.append(`var j={};`);
        propRefs.forEach((pr, i) => {
          methods.toJSON.append(`j[${pr}]=${typeRefs[i]}.toJSON(s[${pr}]);`);
        });
        methods.toJSON.append(`return j;`);
        methods.fromJSON.append(`var s=_alloc();`);
        methods.fromJSON.append(`if(Object.prototype.toString.call(j)==='[object Object]'){`);
        propRefs.forEach((pr, i) => {
          methods.fromJSON.append(`s[${pr}]=${typeRefs[i]}.fromJSON(j[${pr}]);`);
        });
        methods.fromJSON.append(`}`);
        methods.fromJSON.append(`return s;`);
        methods.stats.append(`return {allocCount:${allocCountRef},freeCount:${freeCountRef},poolSize:${poolRef}.length};`);
        const muDataRef = prolog.def("{}");
        propRefs.forEach((pr, i) => {
          prolog.append(`${muDataRef}[${pr}]=${typeRefs[i]};`);
        });
        epilog.append(`return {identity:${identityRef},muData:${muDataRef},pool:${poolRef},`);
        Object.keys(methods).forEach((name) => {
          prolog.append(methods[name].toString());
          epilog.append(`${name}:${name},`);
        });
        epilog.append("}");
        prolog.append(epilog.toString());
        params.push(prolog.toString());
        const proc = Function.apply(null, params);
        const compiled = proc.apply(null, args);
        this.json = json;
        this.muData = compiled.muData;
        this.identity = compiled.identity;
        this.pool = compiled.pool;
        this.alloc = compiled.alloc;
        this.free = compiled.free;
        this.equal = compiled.equal;
        this.clone = compiled.clone;
        this.assign = compiled.assign;
        this.diff = compiled.diff;
        this.patch = compiled.patch;
        this.toJSON = compiled.toJSON;
        this.fromJSON = compiled.fromJSON;
        this.stats = compiled.stats;
      }
    };
    exports.MuStruct = MuStruct9;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/union.js
var require_union = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/union.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuUnion = void 0;
    var MuUnion2 = class {
      constructor(schemaSpec, identityType) {
        this.muType = "union";
        this.muData = schemaSpec;
        this._types = Object.keys(schemaSpec).sort();
        if (identityType) {
          this.identity = {
            type: identityType,
            data: schemaSpec[identityType].identity
          };
        } else {
          this.identity = {
            type: "",
            data: void 0
          };
        }
        const result = {};
        Object.keys(schemaSpec).forEach((subtype) => {
          result[subtype] = schemaSpec[subtype].json;
        });
        this.json = {
          type: "union",
          identity: this.identity.type,
          data: result
        };
      }
      alloc() {
        const type = this.identity.type;
        return {
          type,
          data: type ? this.muData[type].clone(this.identity.data) : void 0
        };
      }
      free(union) {
        const schema = this.muData[union.type];
        if (schema) {
          schema.free(union.data);
        }
      }
      equal(a, b) {
        if (a.type !== b.type) {
          return false;
        }
        if (a.type === "") {
          return true;
        }
        return this.muData[a.type].equal(a.data, b.data);
      }
      clone(union) {
        const type = union.type;
        return {
          type,
          data: type ? this.muData[type].clone(union.data) : void 0
        };
      }
      assign(dst, src) {
        const dType = dst.type;
        const sType = src.type;
        const schema = this.muData;
        dst.type = src.type;
        if (dst.type !== dType) {
          schema[dType] && schema[dType].free(dst.data);
          if (sType) {
            schema[sType] && (dst.data = schema[sType].clone(src.data));
          } else {
            dst.data = void 0;
          }
          return dst;
        }
        if (schema[dType]) {
          dst.data = schema[dType].assign(dst.data, src.data);
        }
        return dst;
      }
      diff(base, target, out) {
        out.grow(8);
        const head = out.offset;
        ++out.offset;
        let opcode = 0;
        const schema = this.muData[target.type];
        if (base.type === target.type) {
          if (schema.diff(base.data, target.data, out)) {
            opcode = 1;
          }
        } else {
          out.writeUint8(this._types.indexOf(target.type));
          if (schema.diff(schema.identity, target.data, out)) {
            opcode = 2;
          } else {
            opcode = 4;
          }
        }
        if (opcode) {
          out.writeUint8At(head, opcode);
          return true;
        }
        out.offset = head;
        return false;
      }
      patch(base, inp) {
        const result = this.clone(base);
        const opcode = inp.readUint8();
        if (opcode === 1) {
          result.data = this.muData[result.type].patch(result.data, inp);
        } else {
          result.type = this._types[inp.readUint8()];
          const schema = this.muData[result.type];
          if (opcode === 2) {
            result.data = schema.patch(schema.identity, inp);
          } else if (opcode === 4) {
            result.data = schema.clone(schema.identity);
          } else {
            throw new Error(`invalid opcode ${opcode}`);
          }
        }
        return result;
      }
      toJSON(union) {
        return {
          type: union.type,
          data: this.muData[union.type].toJSON(union.data)
        };
      }
      fromJSON(x) {
        if (typeof x === "object" && x) {
          const type = x.type;
          if (typeof type === "string" && type in this.muData) {
            return {
              type,
              data: this.muData[type].fromJSON(x.data)
            };
          }
        }
        return this.clone(this.identity);
      }
    };
    exports.MuUnion = MuUnion2;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/bytes.js
var require_bytes = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/bytes.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuBytes = void 0;
    var MuBytes = class {
      constructor(identity) {
        this.muType = "bytes";
        this.pool = {};
        if (identity) {
          this.identity = identity.slice();
        } else {
          this.identity = new Uint8Array(1);
        }
        this.json = {
          type: "bytes",
          identity: `[${Array.prototype.slice.call(this.identity).join()}]`
        };
      }
      _allocBytes(length) {
        return this.pool[length] && this.pool[length].pop() || new Uint8Array(length);
      }
      alloc() {
        return this._allocBytes(this.identity.length);
      }
      free(bytes) {
        const length = bytes.length;
        if (!this.pool[length]) {
          this.pool[length] = [];
        }
        this.pool[length].push(bytes);
      }
      equal(a, b) {
        if (a.length !== b.length) {
          return false;
        }
        for (let i = a.length - 1; i >= 0; --i) {
          if (a[i] !== b[i]) {
            return false;
          }
        }
        return true;
      }
      clone(bytes) {
        const copy = this._allocBytes(bytes.length);
        copy.set(bytes);
        return copy;
      }
      assign(dst, src) {
        if (dst.length !== src.length) {
          throw new Error("dst and src are of different lengths");
        }
        dst.set(src);
        return dst;
      }
      diff(base, target, out) {
        const length = target.length;
        out.grow(5 + length);
        out.writeVarint(length);
        out.buffer.uint8.set(target, out.offset);
        out.offset += length;
        return true;
      }
      patch(base, inp) {
        const length = inp.readVarint();
        const target = this._allocBytes(length);
        const bytes = inp.buffer.uint8.subarray(inp.offset, inp.offset += length);
        target.set(bytes);
        return target;
      }
      toJSON(bytes) {
        const arr = new Array(bytes.length);
        for (let i = 0; i < arr.length; ++i) {
          arr[i] = bytes[i];
        }
        return arr;
      }
      fromJSON(x) {
        if (Array.isArray(x)) {
          const bytes = this._allocBytes(x.length);
          bytes.set(x);
          return bytes;
        }
        return this.clone(this.identity);
      }
    };
    exports.MuBytes = MuBytes;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/dictionary.js
var require_dictionary = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/dictionary.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuDictionary = void 0;
    var is_primitive_1 = require_is_primitive();
    function assignPrimitive(dst, src) {
      const dKeys = Object.keys(dst);
      const sKeys = Object.keys(src);
      for (let i = 0; i < dKeys.length; ++i) {
        const k = dKeys[i];
        if (!(k in src)) {
          delete dst[k];
        }
      }
      for (let i = 0; i < sKeys.length; ++i) {
        const k = sKeys[i];
        dst[k] = src[k];
      }
      return dst;
    }
    function assignGeneric(schema) {
      return (dst, src) => {
        const dKeys = Object.keys(dst);
        const sKeys = Object.keys(src);
        for (let i = 0; i < dKeys.length; ++i) {
          const k = dKeys[i];
          if (!(k in src)) {
            schema.free(dst[k]);
            delete dst[k];
          }
        }
        for (let i = 0; i < sKeys.length; ++i) {
          const k = sKeys[i];
          if (k in dst) {
            dst[k] = schema.assign(dst[k], src[k]);
          } else {
            dst[k] = schema.clone(src[k]);
          }
        }
        return dst;
      };
    }
    var MuDictionary2 = class {
      stats() {
        return {
          allocCount: this.allocCount,
          freeCount: this.freeCount,
          poolSize: 0
        };
      }
      constructor(schema, capacity, identity) {
        this.muType = "dictionary";
        this._isPrimitive = false;
        this.allocCount = 0;
        this.freeCount = 0;
        this.muData = schema;
        this.capacity = capacity;
        this.identity = {};
        if (identity) {
          const keys = Object.keys(identity);
          for (let i = 0; i < keys.length; ++i) {
            const k = keys[i];
            this.identity[k] = schema.clone(identity[k]);
          }
        }
        this.json = {
          type: "dictionary",
          valueType: schema.json,
          identity: JSON.stringify(this.identity)
        };
        this._isPrimitive = (0, is_primitive_1.isMuPrimitiveType)(schema.muType);
        if (this._isPrimitive) {
          this.assign = assignPrimitive;
        } else {
          this.assign = assignGeneric(schema);
        }
      }
      alloc() {
        this.allocCount += 1;
        return {};
      }
      free(dict) {
        this.freeCount += 1;
        if (!this._isPrimitive) {
          const props = Object.keys(dict);
          const schema = this.muData;
          for (let i = 0; i < props.length; ++i) {
            schema.free(dict[props[i]]);
          }
        }
      }
      equal(a, b) {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) {
          return false;
        }
        for (let i = aKeys.length - 1; i >= 0; --i) {
          if (!(aKeys[i] in b)) {
            return false;
          }
        }
        const schema = this.muData;
        for (let i = 0; i < aKeys.length; ++i) {
          const k = aKeys[i];
          if (!schema.equal(a[k], b[k])) {
            return false;
          }
        }
        return true;
      }
      clone(dict) {
        this.allocCount += 1;
        if (this._isPrimitive) {
          return Object.assign({}, dict);
        } else {
          const copy = {};
          const keys = Object.keys(dict);
          const schema = this.muData;
          for (let i = 0; i < keys.length; ++i) {
            const k = keys[i];
            copy[k] = schema.clone(dict[k]);
          }
          return copy;
        }
      }
      diff(base, target, out) {
        let numDel = 0;
        let numPatch = 0;
        let numAdd = 0;
        out.grow(12);
        const head = out.offset;
        out.offset += 12;
        const bKeys = Object.keys(base).sort();
        out.grow(5 * bKeys.length);
        for (let i = 0; i < bKeys.length; ++i) {
          if (!(bKeys[i] in target)) {
            ++numDel;
            out.writeVarint(i);
          }
        }
        const tKeys = Object.keys(target);
        const schema = this.muData;
        const newKeys = [];
        for (let i = 0; i < tKeys.length; ++i) {
          const key = tKeys[i];
          if (key in base) {
            const prefix = out.offset;
            out.grow(5);
            out.writeVarint(bKeys.indexOf(key));
            if (schema.diff(base[key], target[key], out)) {
              ++numPatch;
            } else {
              out.offset = prefix;
            }
          } else {
            newKeys.push(key);
          }
        }
        numAdd = newKeys.length;
        const numTrackers = Math.ceil(numAdd / 8);
        out.grow(numTrackers);
        let trackerOffset = out.offset;
        out.offset += numTrackers;
        let tracker = 0;
        for (let i = 0; i < numAdd; ++i) {
          const key = newKeys[i];
          out.writeString(key);
          if (schema.diff(schema.identity, target[key], out)) {
            tracker |= 1 << (i & 7);
          }
          if ((i & 7) === 7) {
            out.writeUint8At(trackerOffset++, tracker);
            tracker = 0;
          }
        }
        if (numAdd & 7) {
          out.writeUint8At(trackerOffset, tracker);
        }
        if (numDel > 0 || numPatch > 0 || numAdd > 0) {
          out.writeUint32At(head, numDel);
          out.writeUint32At(head + 4, numPatch);
          out.writeUint32At(head + 8, numAdd);
          return true;
        }
        out.offset = head;
        return false;
      }
      patch(base, inp) {
        const numDel = inp.readUint32();
        const numPatch = inp.readUint32();
        const numAdd = inp.readUint32();
        const bKeys = Object.keys(base).sort();
        const numTargetProps = bKeys.length - numDel + numAdd;
        if (numTargetProps > this.capacity) {
          throw new Error(`number of target props ${numTargetProps} exceeds capacity ${this.capacity}`);
        }
        const result = {};
        const schema = this.muData;
        const keysToDel = {};
        for (let i = 0; i < numDel; ++i) {
          keysToDel[bKeys[inp.readVarint()]] = true;
        }
        for (let i = 0; i < bKeys.length; ++i) {
          const key = bKeys[i];
          if (!keysToDel[key]) {
            result[key] = schema.clone(base[key]);
          }
        }
        for (let i = 0; i < numPatch; ++i) {
          const idx = inp.readVarint();
          const key = bKeys[idx];
          if (!key) {
            throw new Error(`invalid index of key`);
          }
          result[key] = schema.patch(base[key], inp);
        }
        const numFullTrackers = numAdd / 8 | 0;
        const numTrackers = Math.ceil(numAdd / 8);
        let trackerOffset = inp.offset;
        inp.offset += numTrackers;
        for (let i = 0; i < numFullTrackers; ++i) {
          const tracker = inp.readUint8At(trackerOffset++);
          for (let j = 0; j < 8; ++j) {
            result[inp.readString()] = tracker & 1 << j ? schema.patch(schema.identity, inp) : schema.clone(schema.identity);
          }
        }
        if (numAdd & 7) {
          const tracker = inp.readUint8At(trackerOffset);
          for (let i = 0; i < (numAdd & 7); ++i) {
            result[inp.readString()] = tracker & 1 << i ? schema.patch(schema.identity, inp) : schema.clone(schema.identity);
          }
        }
        this.allocCount += 1;
        return result;
      }
      toJSON(dict) {
        const json = {};
        const keys = Object.keys(dict);
        const schema = this.muData;
        for (let i = 0; i < keys.length; ++i) {
          const k = keys[i];
          json[k] = schema.toJSON(dict[k]);
        }
        return json;
      }
      fromJSON(x) {
        this.allocCount += 1;
        if (Object.prototype.toString.call(x) === "[object Object]") {
          const dict = {};
          const keys = Object.keys(x);
          const schema = this.muData;
          for (let i = 0; i < keys.length; ++i) {
            const k = keys[i];
            dict[k] = schema.fromJSON(x[k]);
          }
          return dict;
        }
        return this.clone(this.identity);
      }
    };
    exports.MuDictionary = MuDictionary2;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/vector.js
var require_vector = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/vector.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuVector = void 0;
    var muTypeToTypedArray = {
      float32: Float32Array,
      float64: Float64Array,
      int8: Int8Array,
      int16: Int16Array,
      int32: Int32Array,
      uint8: Uint8Array,
      uint16: Uint16Array,
      uint32: Uint32Array
    };
    var MuVector2 = class {
      stats() {
        return {
          allocCount: this.allocCount,
          freeCount: this.freeCount,
          poolSize: this.pool.length
        };
      }
      constructor(schema, dimension) {
        this.muType = "vector";
        this.allocCount = 0;
        this.freeCount = 0;
        this.pool = [];
        this.muData = schema;
        this.dimension = dimension;
        this.TypedArray = muTypeToTypedArray[schema.muType];
        this.identity = new this.TypedArray(dimension);
        for (let i = 0; i < dimension; ++i) {
          this.identity[i] = schema.identity;
        }
        this.json = {
          type: "vector",
          valueType: schema.json,
          dimension
        };
        this.__b = new this.TypedArray(dimension);
        this.__t = new this.TypedArray(dimension);
        this._b = new Uint8Array(this.__b.buffer);
        this._t = new Uint8Array(this.__t.buffer);
      }
      alloc() {
        this.allocCount++;
        return this.pool.pop() || new this.TypedArray(this.dimension);
      }
      free(vec) {
        this.freeCount++;
        this.pool.push(vec);
      }
      equal(a, b) {
        if (!(a instanceof this.TypedArray) || !(b instanceof this.TypedArray)) {
          return false;
        }
        if (a.length !== b.length) {
          return false;
        }
        for (let i = a.length - 1; i >= 0; --i) {
          if (a[i] !== b[i]) {
            return false;
          }
        }
        return true;
      }
      clone(vec) {
        const copy = this.alloc();
        copy.set(vec);
        return copy;
      }
      assign(dst, src) {
        dst.set(src);
        return dst;
      }
      diff(base, target, out) {
        this.__b.set(base);
        this.__t.set(target);
        const byteLength = this.identity.byteLength;
        out.grow(Math.ceil(byteLength * 9 / 8));
        const head = out.offset;
        let trackerOffset = head;
        out.offset += Math.ceil(byteLength / 8);
        let tracker = 0;
        let numPatches = 0;
        for (let i = 0; i < byteLength; ++i) {
          if (this._b[i] !== this._t[i]) {
            out.writeUint8(this._t[i]);
            tracker |= 1 << (i & 7);
            ++numPatches;
          }
          if ((i & 7) === 7) {
            out.writeUint8At(trackerOffset++, tracker);
            tracker = 0;
          }
        }
        if (numPatches === 0) {
          out.offset = head;
          return false;
        }
        if (byteLength & 7) {
          out.writeUint8At(trackerOffset, tracker);
        }
        return true;
      }
      patch(base, inp) {
        const head = inp.offset;
        const numTrackerBits = this.dimension * this.identity.BYTES_PER_ELEMENT;
        const numTrackerFullBytes = Math.floor(numTrackerBits / 8);
        const numTrackerBytes = Math.ceil(numTrackerBits / 8);
        inp.offset = head + numTrackerBytes;
        this.__b.set(base);
        for (let i = 0; i < numTrackerFullBytes; ++i) {
          const start = i * 8;
          const tracker = inp.readUint8At(head + i);
          for (let j = 0; j < 8; ++j) {
            if (tracker & 1 << j) {
              this._b[start + j] = inp.readUint8();
            }
          }
        }
        if (numTrackerBits & 7) {
          const start = numTrackerFullBytes * 8;
          const tracker = inp.readUint8At(head + numTrackerFullBytes);
          const partialBits = numTrackerBits & 7;
          for (let j = 0; j < partialBits; ++j) {
            if (tracker & 1 << j) {
              this._b[start + j] = inp.readUint8();
            }
          }
        }
        return this.clone(this.__b);
      }
      toJSON(vec) {
        const arr = new Array(vec.length);
        for (let i = 0; i < arr.length; ++i) {
          arr[i] = vec[i];
        }
        return arr;
      }
      fromJSON(x) {
        if (Array.isArray(x)) {
          const vec = this.alloc();
          for (let i = 0; i < vec.length; ++i) {
            vec[i] = this.muData.fromJSON(x[i]);
          }
          return vec;
        }
        return this.clone(this.identity);
      }
    };
    exports.MuVector = MuVector2;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/date.js
var require_date = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/date.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuDate = void 0;
    var MuDate = class {
      constructor(identity) {
        this.muType = "date";
        this.identity = /* @__PURE__ */ new Date(0);
        if (identity) {
          this.identity.setTime(identity.getTime());
        }
        this.json = {
          type: "date",
          identity: this.identity.toISOString()
        };
      }
      alloc() {
        return /* @__PURE__ */ new Date();
      }
      free(date) {
      }
      equal(a, b) {
        return a.getTime() === b.getTime();
      }
      clone(date_) {
        const date = this.alloc();
        date.setTime(date_.getTime());
        return date;
      }
      assign(dst, src) {
        dst.setTime(src.getTime());
        return dst;
      }
      diff(base, target, out) {
        const bt = base.getTime();
        const tt = target.getTime();
        if (bt !== tt) {
          out.grow(10);
          out.writeVarint(tt % 268435456);
          out.writeVarint(tt / 268435456 | 0);
          return true;
        }
        return false;
      }
      patch(base, inp) {
        const date = this.alloc();
        const lo = inp.readVarint();
        const hi = inp.readVarint();
        date.setTime(lo + 268435456 * hi);
        return date;
      }
      toJSON(date) {
        return date.toISOString();
      }
      fromJSON(x) {
        if (typeof x === "string") {
          return new Date(x);
        }
        return this.clone(this.identity);
      }
    };
    exports.MuDate = MuDate;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/json.js
var require_json = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/json.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuJSON = exports.deepClone = exports.deepEqual = void 0;
    function equal(a, b) {
      if (a === b) {
        return true;
      }
      if (a && b && typeof a === "object" && typeof b === "object") {
        const aIsArr = Array.isArray(a);
        const bIsArr = Array.isArray(b);
        if (aIsArr !== bIsArr) {
          return false;
        }
        if (aIsArr) {
          const leng = a.length;
          if (leng !== b.length) {
            return false;
          }
          for (let i = leng - 1; i >= 0; --i) {
            if (!equal(a[i], b[i])) {
              return false;
            }
          }
          return true;
        }
        const keys = Object.keys(a);
        if (keys.length !== Object.keys(b).length) {
          return false;
        }
        for (let i = 0; i < keys.length; ++i) {
          const key = keys[i];
          if (!b.hasOwnProperty(key) || !equal(a[key], b[key])) {
            return false;
          }
        }
        return true;
      }
      return a !== a && b !== b;
    }
    function clone(x) {
      if (typeof x !== "object" || x === null) {
        return x;
      }
      const copy = Array.isArray(x) ? [] : {};
      if (Array.isArray(copy)) {
        copy.length = x.length;
        for (let i = 0; i < x.length; ++i) {
          copy[i] = clone(x[i]);
        }
      } else {
        const keys = Object.keys(x);
        for (let i = 0; i < keys.length; ++i) {
          const key = keys[i];
          copy[key] = clone(x[key]);
        }
      }
      return copy;
    }
    exports.deepEqual = equal;
    exports.deepClone = clone;
    var MuJSON = class {
      constructor(identity) {
        this.muType = "json";
        this.identity = identity && clone(identity);
        this.identity = this.identity || {};
        this.json = {
          type: "json",
          identity: this.identity
        };
      }
      alloc() {
        return {};
      }
      free() {
      }
      equal(a, b) {
        return (0, exports.deepEqual)(a, b);
      }
      clone(obj) {
        return (0, exports.deepClone)(obj);
      }
      assign(dst, src) {
        if (Array.isArray(dst) && Array.isArray(src)) {
          dst.length = src.length;
          for (let i = 0; i < dst.length; ++i) {
            dst[i] = (0, exports.deepClone)(src[i]);
          }
          return dst;
        }
        const dKeys = Object.keys(dst);
        for (let i = 0; i < dKeys.length; ++i) {
          const key = dKeys[i];
          if (!(key in src)) {
            delete dst[key];
          }
        }
        const sKeys = Object.keys(src);
        for (let i = 0; i < sKeys.length; ++i) {
          const key = sKeys[i];
          dst[key] = (0, exports.deepClone)(src[key]);
        }
        return dst;
      }
      diff(base, target, out) {
        const str = JSON.stringify(target);
        out.writeString(str);
        return true;
      }
      patch(base, inp) {
        return JSON.parse(inp.readString());
      }
      toJSON(obj) {
        return obj;
      }
      fromJSON(x) {
        if (typeof x === "object" && x) {
          return x;
        }
        return this.clone(this.identity);
      }
    };
    exports.MuJSON = MuJSON;
  }
});

// ../dao3 max/box3-local-engine/packages/mudb/schema/index.js
var require_schema = __commonJS({
  "../dao3 max/box3-local-engine/packages/mudb/schema/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MuJSON = exports.MuDate = exports.MuDictionary = exports.MuVector = exports.MuBytes = exports.MuUnion = exports.MuStruct = exports.MuSortedArray = exports.MuOption = exports.MuArray = exports.MuQuantizedFloat = exports.MuRelativeVarint = exports.MuVarint = exports.MuUint32 = exports.MuUint16 = exports.MuUint8 = exports.MuInt32 = exports.MuInt16 = exports.MuInt8 = exports.MuFloat64 = exports.MuFloat32 = exports.MuUTF8 = exports.MuFixedASCII = exports.MuASCII = exports.MuBoolean = exports.MuVoid = void 0;
    var void_1 = require_void();
    Object.defineProperty(exports, "MuVoid", { enumerable: true, get: function() {
      return void_1.MuVoid;
    } });
    var boolean_1 = require_boolean();
    Object.defineProperty(exports, "MuBoolean", { enumerable: true, get: function() {
      return boolean_1.MuBoolean;
    } });
    var ascii_1 = require_ascii();
    Object.defineProperty(exports, "MuASCII", { enumerable: true, get: function() {
      return ascii_1.MuASCII;
    } });
    var fixed_ascii_1 = require_fixed_ascii();
    Object.defineProperty(exports, "MuFixedASCII", { enumerable: true, get: function() {
      return fixed_ascii_1.MuFixedASCII;
    } });
    var utf8_1 = require_utf8();
    Object.defineProperty(exports, "MuUTF8", { enumerable: true, get: function() {
      return utf8_1.MuUTF8;
    } });
    var float32_1 = require_float32();
    Object.defineProperty(exports, "MuFloat32", { enumerable: true, get: function() {
      return float32_1.MuFloat32;
    } });
    var float64_1 = require_float64();
    Object.defineProperty(exports, "MuFloat64", { enumerable: true, get: function() {
      return float64_1.MuFloat64;
    } });
    var int8_1 = require_int8();
    Object.defineProperty(exports, "MuInt8", { enumerable: true, get: function() {
      return int8_1.MuInt8;
    } });
    var int16_1 = require_int16();
    Object.defineProperty(exports, "MuInt16", { enumerable: true, get: function() {
      return int16_1.MuInt16;
    } });
    var int32_1 = require_int32();
    Object.defineProperty(exports, "MuInt32", { enumerable: true, get: function() {
      return int32_1.MuInt32;
    } });
    var uint8_1 = require_uint8();
    Object.defineProperty(exports, "MuUint8", { enumerable: true, get: function() {
      return uint8_1.MuUint8;
    } });
    var uint16_1 = require_uint16();
    Object.defineProperty(exports, "MuUint16", { enumerable: true, get: function() {
      return uint16_1.MuUint16;
    } });
    var uint32_1 = require_uint32();
    Object.defineProperty(exports, "MuUint32", { enumerable: true, get: function() {
      return uint32_1.MuUint32;
    } });
    var varint_1 = require_varint();
    Object.defineProperty(exports, "MuVarint", { enumerable: true, get: function() {
      return varint_1.MuVarint;
    } });
    var rvarint_1 = require_rvarint();
    Object.defineProperty(exports, "MuRelativeVarint", { enumerable: true, get: function() {
      return rvarint_1.MuRelativeVarint;
    } });
    var quantized_float_1 = require_quantized_float();
    Object.defineProperty(exports, "MuQuantizedFloat", { enumerable: true, get: function() {
      return quantized_float_1.MuQuantizedFloat;
    } });
    var array_1 = require_array();
    Object.defineProperty(exports, "MuArray", { enumerable: true, get: function() {
      return array_1.MuArray;
    } });
    var option_1 = require_option();
    Object.defineProperty(exports, "MuOption", { enumerable: true, get: function() {
      return option_1.MuOption;
    } });
    var sorted_array_1 = require_sorted_array();
    Object.defineProperty(exports, "MuSortedArray", { enumerable: true, get: function() {
      return sorted_array_1.MuSortedArray;
    } });
    var struct_1 = require_struct();
    Object.defineProperty(exports, "MuStruct", { enumerable: true, get: function() {
      return struct_1.MuStruct;
    } });
    var union_1 = require_union();
    Object.defineProperty(exports, "MuUnion", { enumerable: true, get: function() {
      return union_1.MuUnion;
    } });
    var bytes_1 = require_bytes();
    Object.defineProperty(exports, "MuBytes", { enumerable: true, get: function() {
      return bytes_1.MuBytes;
    } });
    var dictionary_1 = require_dictionary();
    Object.defineProperty(exports, "MuDictionary", { enumerable: true, get: function() {
      return dictionary_1.MuDictionary;
    } });
    var vector_1 = require_vector();
    Object.defineProperty(exports, "MuVector", { enumerable: true, get: function() {
      return vector_1.MuVector;
    } });
    var date_1 = require_date();
    Object.defineProperty(exports, "MuDate", { enumerable: true, get: function() {
      return date_1.MuDate;
    } });
    var json_1 = require_json();
    Object.defineProperty(exports, "MuJSON", { enumerable: true, get: function() {
      return json_1.MuJSON;
    } });
  }
});

// ../dao3 max/box3-local-engine/packages/mesher/build/schema.js
var require_schema2 = __commonJS({
  "../dao3 max/box3-local-engine/packages/mesher/build/schema.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MeshDataSchema = exports.MeshTextureSchema = void 0;
    var schema_1 = require_schema();
    exports.MeshTextureSchema = new schema_1.MuStruct({
      palette: new schema_1.MuArray(new schema_1.MuUint32(), Infinity),
      data: new schema_1.MuArray(new schema_1.MuVarint(), Infinity),
      width: new schema_1.MuVarint()
    });
    exports.MeshDataSchema = new schema_1.MuArray(new schema_1.MuStruct({
      vertices: new schema_1.MuArray(new schema_1.MuVarint(), Infinity),
      sizes: new schema_1.MuArray(new schema_1.MuVarint(), Infinity),
      uvs: new schema_1.MuArray(new schema_1.MuVarint(), Infinity),
      uvFlags: new schema_1.MuArray(new schema_1.MuUint8(), Infinity)
    }), 6);
  }
});

// ../dao3 max/box3-local-engine/packages/mesher/build/texture.js
var require_texture = __commonJS({
  "../dao3 max/box3-local-engine/packages/mesher/build/texture.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Texture = void 0;
    exports.optimizeTexture = optimizeTexture;
    exports.scaleTexture = scaleTexture;
    exports.packTexture = packTexture;
    exports.textureNodeToTexture = textureNodeToTexture;
    exports.packTextures = packTextures;
    exports.flipTexture = flipTexture;
    exports.rotateTexture = rotateTexture;
    exports.extendTextureEdge = extendTextureEdge;
    var TextureNode = class _TextureNode {
      constructor(texture) {
        this.texture = texture;
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.rotation = 0;
        this.id = _TextureNode.count++;
        if (texture) {
          this.width = texture.width;
          this.height = texture.height;
        } else {
          this.children = [];
        }
      }
    };
    TextureNode.count = 0;
    function gcd(n, m) {
      return n % m ? gcd(m, n % m) : m;
    }
    var Texture = class {
      constructor(width, height, data) {
        this.width = width;
        this.height = height;
        this.data = data || Array(width * height).fill(0);
      }
      set(x, y, value) {
        this.data[y * this.width + x] = value;
      }
      get(x, y) {
        return this.data[y * this.width + x];
      }
    };
    exports.Texture = Texture;
    function optimizeTexture(texture, extendEdge = false) {
      let gcdRow = 0;
      let gcdColumn = 0;
      for (let i = 0; i < texture.height; i++) {
        let count = 1;
        for (let j = 1; j <= texture.width; j++) {
          if (j < texture.width && texture.get(j, i) === texture.get(j - 1, i)) {
            count++;
          } else {
            gcdRow = gcd(gcdRow, count);
            count = 1;
          }
        }
      }
      for (let i = 0; i < texture.width; i++) {
        let count = 1;
        for (let j = 1; j <= texture.height; j++) {
          if (j < texture.height && texture.get(i, j) === texture.get(i, j - 1)) {
            count++;
          } else {
            gcdColumn = gcd(gcdColumn, count);
            count = 1;
          }
        }
      }
      if (gcdRow === 0) {
        gcdRow = 1;
      }
      if (gcdColumn === 0) {
        gcdColumn = 1;
      }
      if (gcdRow == 1 && gcdColumn == 1 && !extendEdge) {
        return texture;
      }
      const txt = new Texture(texture.width / gcdRow + (extendEdge ? 2 : 0), texture.height / gcdColumn + (extendEdge ? 2 : 0));
      let ptr = extendEdge ? txt.width + 1 : 0;
      const skips = extendEdge ? 2 : 0;
      for (let i = 0; i < texture.data.length; i++) {
        txt.data[ptr++] = texture.data[i];
        i += gcdRow - 1;
        if (i % texture.width === texture.width - 1) {
          i += texture.width * (gcdColumn - 1);
          ptr += skips;
        }
      }
      if (extendEdge) {
        for (let i = 0; i < txt.width; i++) {
          txt.data[i] = txt.data[i + txt.width];
          txt.data[txt.data.length - 1 - i] = txt.data[txt.data.length - 1 - i - txt.width];
        }
        for (let i = 0; i < txt.height; i++) {
          txt.data[i * txt.width] = txt.data[i * txt.width + 1];
          txt.data[i * txt.width + txt.width - 1] = txt.data[i * txt.width + txt.width - 2];
        }
      }
      return txt;
    }
    function scaleTexture(texture, widthScale = 1, heightScale = 1) {
      const txt = new Texture(texture.width * widthScale, texture.height * heightScale);
      let ptr = 0;
      for (let i = 0; i < texture.data.length; i++) {
        for (let j = 0; j < widthScale; j++) {
          txt.data[ptr++] = texture.data[i];
        }
        if (i % texture.width === texture.width - 1) {
          for (let j = 0; j < heightScale - 1; j++) {
            for (let k = 0; k < texture.width * widthScale; k++) {
              txt.data[ptr] = txt.data[ptr - texture.width * widthScale];
              ptr++;
            }
          }
        }
      }
      return txt;
    }
    function packTexture(a, b, freespaces) {
      if (Math.max(a.width, a.height) < Math.max(b.width, b.height)) {
        return packTexture(b, a, freespaces);
      }
      const extendedWidth = a.width < a.height;
      b.rotation = b.width < b.height === extendedWidth ? 0 : 1;
      b.x = extendedWidth ? a.width : 0;
      b.y = extendedWidth ? 0 : a.height;
      const width = a.width + (extendedWidth ? b.rotation ? b.height : b.width : 0);
      const height = a.height + (extendedWidth ? 0 : b.rotation ? b.width : b.height);
      const node = new TextureNode();
      node.width = width;
      node.height = height;
      node.children.push(a, b);
      const bWidth = b.rotation ? b.height : b.width;
      const bHeight = b.rotation ? b.width : b.height;
      if (extendedWidth) {
        const y = b.y + bHeight;
        if (y < height) {
          freespaces.push({
            node,
            x: b.x,
            y: bHeight,
            width: bWidth,
            height: height - bHeight,
            minWH: Math.min(bWidth, height - bHeight),
            maxWH: Math.max(bWidth, height - bHeight)
          });
        }
      } else {
        const x = b.x + bWidth;
        if (x < width) {
          freespaces.push({
            node,
            x: bWidth,
            y: b.y,
            width: width - bWidth,
            height: bHeight,
            minWH: Math.min(width - bWidth, bHeight),
            maxWH: Math.max(width - bWidth, bHeight)
          });
        }
      }
      return node;
    }
    function fillFreeSpace(texture, freespaces, idx) {
      const [f] = freespaces.splice(idx, 1);
      let { width, height } = texture;
      if (texture.width > f.width || texture.height > f.height) {
        width = texture.height;
        height = texture.width;
        texture.rotation = 1;
      }
      texture.x = f.x;
      texture.y = f.y;
      f.node.children.push(texture);
      const rightSpace = (f.width - width) * f.height;
      const bottomSpace = f.width * (f.height - height);
      if (rightSpace > bottomSpace) {
        const w = f.width - width;
        const h = f.height;
        freespaces.push({
          node: f.node,
          x: f.x + width,
          y: f.y,
          width: w,
          height: h,
          minWH: Math.min(w, h),
          maxWH: Math.max(w, h)
        });
        if (bottomSpace > 0) {
          const w2 = width;
          const h2 = f.height - height;
          freespaces.push({
            node: f.node,
            x: f.x,
            y: f.y + height,
            width: w2,
            height: h2,
            minWH: Math.min(w2, h2),
            maxWH: Math.max(w2, h2)
          });
        }
      } else if (bottomSpace > rightSpace) {
        const w = f.width;
        const h = f.height - height;
        freespaces.push({
          node: f.node,
          x: f.x,
          y: f.y + height,
          width: w,
          height: h,
          minWH: Math.min(w, h),
          maxWH: Math.max(w, h)
        });
        if (rightSpace > 0) {
          const w2 = f.width - width;
          const h2 = height;
          freespaces.push({
            node: f.node,
            x: f.x + width,
            y: f.y,
            width: w2,
            height: h2,
            minWH: Math.min(w2, h2),
            maxWH: Math.max(w2, h2)
          });
        }
      }
    }
    function textureNodeToTexture(node) {
      const texture = new Texture(node.width, node.height);
      const positions = /* @__PURE__ */ new Map();
      function draw(n, x, y, rotation) {
        if (n.texture) {
          for (let i = 0; i < n.texture.width; i++) {
            for (let j = 0; j < n.texture.height; j++) {
              texture.set(x + (rotation ? n.texture.height - 1 - j : i), y + (rotation ? i : j), n.texture.get(i, j));
            }
          }
          positions.set(n.texture, {
            x,
            y,
            rotation,
            width: rotation ? n.texture.height : n.texture.width,
            height: rotation ? n.texture.width : n.texture.height
          });
          delete n.texture;
        } else {
          for (const c of n.children) {
            draw(c, x + (rotation ? c.y : c.x), y + (rotation ? c.x : c.y), rotation ^ c.rotation);
          }
        }
      }
      draw(node, node.x, node.y, node.rotation);
      return {
        texture,
        positions
      };
    }
    function packTextures(textures) {
      const txts = textures.map((t) => new TextureNode(t)).sort((a, b) => {
        const aa = a.width * a.height;
        const ab = b.width * b.height;
        if (aa === ab) {
          const xa = Math.max(a.width, a.height);
          const xb = Math.max(b.width, b.height);
          if (xa === xb) {
            return Math.min(b.width, b.height) - Math.min(a.width, a.height);
          }
          return xb - xa;
        }
        return ab - aa;
      });
      let texture = txts[0];
      const freespaces = [];
      for (let i = 1; i < txts.length; i++) {
        const txt = txts[i];
        const minWH = Math.min(txt.width, txt.height);
        const maxWH = Math.max(txt.width, txt.height);
        let best = -1;
        for (let j = 0; j < freespaces.length; j++) {
          const cur = freespaces[j];
          if (cur.minWH >= minWH && cur.maxWH >= maxWH) {
            if (best === -1) {
              best = j;
            } else {
              const pre = freespaces[best];
              if (cur.width * cur.height < pre.width * pre.height) {
                best = j;
              }
            }
          }
        }
        if (best !== -1) {
          fillFreeSpace(txt, freespaces, best);
        } else {
          texture = packTexture(texture, txt, freespaces);
        }
      }
      return {
        texture,
        wastes: freespaces.reduce((prev, cur) => prev + cur.width * cur.height, 0)
      };
    }
    function flipTexture(a) {
      const t = new Texture(a.height, a.width);
      for (let i = 0; i < a.width; i++) {
        for (let j = 0; j < a.height; j++) {
          t.set(j, i, a.get(i, j));
        }
      }
      return t;
    }
    function rotateTexture(a) {
      const t = new Texture(a.height, a.width);
      for (let i = 0; i < a.width; i++) {
        for (let j = 0; j < a.height; j++) {
          t.set(j, i, a.get(a.width - 1 - i, j));
        }
      }
      return t;
    }
    function extendTextureEdge(a) {
      const t = new Texture(a.width + 2, a.height + 2);
      for (let i = 0; i < t.width; i++) {
        for (let j = 0; j < t.height; j++) {
          t.set(i, j, a.get(Math.min(Math.max(0, i - 1), a.width - 1), Math.min(Math.max(0, j - 1), a.height - 1)));
        }
      }
      return t;
    }
  }
});

// ../dao3 max/box3-local-engine/packages/mesher/build/murmur3.js
var require_murmur3 = __commonJS({
  "../dao3 max/box3-local-engine/packages/mesher/build/murmur3.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.murmur3 = murmur3;
    var v = new Uint32Array(2);
    function murmur_32_scramble() {
      v[1] = Math.imul(v[1], 3432918353);
      v[1] = v[1] << 15 | v[1] >>> 17;
      v[1] = Math.imul(v[1], 461845907);
      v[0] ^= v[1];
    }
    function murmur3(texture, seed, flipped = 0, rotate = 0) {
      const { width: w, height: h, data } = texture;
      const dataMapper = [
        [
          (x) => data[x],
          (x) => data[w * (h - 1) + Math.floor(x / h) - x % h * w],
          (x) => data[w * h - 1 - x],
          (x) => data[w - 1 - Math.floor(x / h) + x % h * w]
        ],
        [
          (x) => data[Math.floor(x / h) + x % h * w],
          (x) => data[w * (h - 1 - Math.floor(x / w)) + x % w],
          (x) => data[w * h - Math.floor(x / h) - 1 - x % h * w],
          (x) => data[Math.floor(x / w + 1) * w - 1 - x % w]
        ]
      ];
      const d = dataMapper[flipped][rotate];
      v[0] = seed;
      for (let i = 0, len = data.length >> 2; len > 0; len--) {
        v[1] = d(i++) | d(i++) << 8 | d(i++) << 16 | d(i++) << 24;
        murmur_32_scramble();
        v[0] = v[0] << 13 | v[0] >>> 19;
        v[0] = Math.imul(v[0], 5) + 3864292196;
      }
      v[1] = 0;
      for (let i = data.length - 1, len = data.length & 3; len > 0; len--) {
        v[1] <<= 8;
        v[1] |= d(i--);
      }
      murmur_32_scramble();
      v[0] ^= data.length;
      v[0] ^= v[0] >>> 16;
      v[0] = Math.imul(v[0], 2246822507);
      v[0] ^= v[0] >>> 13;
      v[0] = Math.imul(v[0], 3266489909);
      v[0] ^= v[0] >>> 16;
      return v[0];
    }
  }
});

// ../dao3 max/box3-local-engine/packages/mesher/build/index.js
var require_build = __commonJS({
  "../dao3 max/box3-local-engine/packages/mesher/build/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Mesher = void 0;
    exports.voxelToRectangles = voxelToRectangles;
    exports.getTexture = getTexture;
    exports.textureToMeshTexture = textureToMeshTexture;
    exports.rectanglesToMeshData = rectanglesToMeshData;
    exports.voxelsToMeshes = voxelsToMeshes2;
    exports.unpackTextureData = unpackTextureData2;
    exports.unpackMeshData = unpackMeshData2;
    exports.getVertexCount = getVertexCount;
    var texture_1 = require_texture();
    var murmur3_1 = require_murmur3();
    var schema_1 = require_schema2();
    function checkTexture(texture, textureMap) {
      let baseHash;
      const strSize = [texture.width.toString(36), texture.height.toString(36)];
      for (let flip = 0; flip < 2; flip++) {
        for (let rotation = 0; rotation < 4; rotation++) {
          const sizeIndex = flip ^ rotation & 1;
          const hash = `${strSize[sizeIndex]}_${strSize[1 - sizeIndex]}_` + (0, murmur3_1.murmur3)(texture, 123456, flip, rotation).toString(36) + (0, murmur3_1.murmur3)(texture, 452362, flip, rotation).toString(36) + (0, murmur3_1.murmur3)(texture, 7456443, flip, rotation).toString(36) + (0, murmur3_1.murmur3)(texture, 143525, flip, rotation).toString(36);
          if (!baseHash) {
            baseHash = hash;
          }
          if (textureMap.has(hash)) {
            return {
              hash,
              flipped: flip !== 0,
              rotation,
              existed: true
            };
          }
        }
      }
      return {
        hash: baseHash,
        flipped: false,
        rotation: 0,
        existed: false
      };
    }
    function scanModel(rectangles, textureMap, data, offset, stride, shape, order, faceNormal, hasVoxel, compress = true, extendEdge = false, needSquash = false) {
      const inverseOrder = Array(3);
      order.forEach((x, i) => inverseOrder[x] = i);
      const scanStride = order.map((i) => stride[i]);
      const scanShape = order.map((i) => shape[i]);
      const layerBegin = faceNormal & 1 ? scanShape[2] - 1 : 0;
      const layerEnd = faceNormal & 1 ? -1 : scanShape[2];
      const layerStep = faceNormal & 1 ? -1 : 1;
      function adjustVertex(...v) {
        return {
          x: v[inverseOrder[0]],
          y: v[inverseOrder[1]],
          z: v[inverseOrder[2]]
        };
      }
      for (let layer = layerBegin; layer !== layerEnd; layer += layerStep) {
        const lastSegments = [];
        for (let row = 0; row <= scanShape[1]; row++) {
          const segments = [];
          let start = -1;
          for (let x = 0; x <= scanShape[0] && row < scanShape[1]; x++) {
            const ptr = x * scanStride[0] + row * scanStride[1] + layer * scanStride[2] + offset;
            const prePtr = x * scanStride[0] + row * scanStride[1] + (layer - layerStep) * scanStride[2] + offset;
            if (x < scanShape[0] && hasVoxel(ptr) && (layer === layerBegin || data[prePtr] === 0)) {
              if (start === -1) {
                start = x;
              }
            } else if (start !== -1) {
              segments.push({
                row,
                start,
                width: x - start
              });
              start = -1;
            }
          }
          let ptr0 = 0;
          for (let i = 0; i < lastSegments.length; i++) {
            let flag = true;
            const s0 = lastSegments[i];
            let ptr1 = 0;
            for (let j = 0; j < segments.length && row < scanShape[1]; j++) {
              const s1 = segments[j];
              if (s0.start === s1.start && s0.width === s1.width) {
                flag = false;
              } else {
                segments[ptr1++] = segments[j];
              }
            }
            segments.length = ptr1;
            if (flag) {
              const height = row - s0.row;
              const texture = new texture_1.Texture(s0.width, height);
              for (let j = 0; j < texture.width; j++) {
                for (let k = 0; k < texture.height; k++) {
                  const x = s0.start + j;
                  const y = s0.row + k;
                  texture.set(j, k, data[x * scanStride[0] + y * scanStride[1] + layer * scanStride[2]]);
                }
              }
              const bias = faceNormal & 1;
              const optimizedTexture = compress ? (0, texture_1.optimizeTexture)(texture, extendEdge) : extendEdge ? (0, texture_1.extendTextureEdge)(texture) : texture;
              const { existed, flipped, rotation, hash } = checkTexture(optimizedTexture, textureMap);
              if (!existed) {
                textureMap.set(hash, optimizedTexture);
              }
              rectangles.push(Object.assign(Object.assign({}, adjustVertex(s0.start, +s0.row, needSquash ? 0 : bias + layer)), { width: s0.width, height, texture: {
                hash,
                rotation,
                flipped
              } }));
            } else {
              lastSegments[ptr0++] = lastSegments[i];
            }
          }
          for (let i = 0; i < segments.length; i++) {
            lastSegments[ptr0++] = segments[i];
          }
          lastSegments.length = ptr0;
        }
      }
    }
    function getAirVoxels(voxel, pos, s) {
      const { shape: [nx, ny, nz], stride: [sx, sy, sz], offset, data } = voxel;
      const stack = pos.slice();
      while (stack.length > 0) {
        const z = stack.pop();
        const y = stack.pop();
        const x = stack.pop();
        const ptr = x * sx + y * sy + z * sz + offset;
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz || s.has(ptr) || data[offset + ptr]) {
          continue;
        }
        s.add(ptr);
        stack.push(x + 1, y, z);
        stack.push(x - 1, y, z);
        stack.push(x, y + 1, z);
        stack.push(x, y - 1, z);
        stack.push(x, y, z + 1);
        stack.push(x, y, z - 1);
      }
    }
    function voxelToRectangles(voxel, textureMap, compress = true, extendEdge = false, surfaceOnly = false, squashDimension = 3) {
      const needSquash = squashDimension === 0 || squashDimension === 1 || squashDimension === 2;
      const { data, offset, stride, shape } = voxel;
      let orders = [
        [1, 2, 0],
        [1, 2, 0],
        [0, 2, 1],
        [0, 2, 1],
        [0, 1, 2],
        [0, 1, 2]
      ];
      let orderIdxOffset = 0;
      if (needSquash) {
        orders = orders.slice(squashDimension * 2, squashDimension * 2 + 2);
        orderIdxOffset = squashDimension * 2;
      }
      const hasVoxel = surfaceOnly ? (() => {
        const airVoxelSet = /* @__PURE__ */ new Set();
        const [nx, ny, nz] = shape;
        for (let x = 0; x < nx; x++) {
          for (let y = 0; y < ny; y++) {
            getAirVoxels(voxel, [x, y, 0], airVoxelSet);
            getAirVoxels(voxel, [x, y, nz - 1], airVoxelSet);
          }
          for (let z = 0; z < nz; z++) {
            getAirVoxels(voxel, [x, 0, z], airVoxelSet);
            getAirVoxels(voxel, [x, ny - 1, z], airVoxelSet);
          }
        }
        for (let z = 0; z < nz; z++) {
          for (let y = 0; y < ny; y++) {
            getAirVoxels(voxel, [0, y, z], airVoxelSet);
            getAirVoxels(voxel, [nx - 1, y, z], airVoxelSet);
          }
        }
        return (ptr) => !airVoxelSet.has(ptr);
      })() : (ptr) => data[ptr] !== 0;
      const rectangles = [[], [], [], [], [], []];
      for (let i = 0; i < orders.length; i++) {
        scanModel(rectangles[i + orderIdxOffset], textureMap, data, offset, stride, shape, orders[i], i + orderIdxOffset, hasVoxel, compress, extendEdge, needSquash);
      }
      return rectangles;
    }
    function getTexture(textureMap) {
      const { texture } = (0, texture_1.packTextures)(Array.from(textureMap.values()));
      return (0, texture_1.textureNodeToTexture)(texture);
    }
    async function textureToMeshTexture(texture, palette, emissivePalette = Array(palette.length).fill(0)) {
      const meshTexture = schema_1.MeshTextureSchema.alloc();
      const plet = meshTexture.palette;
      if (typeof palette[0] === "number") {
        for (let i = 0; i < palette.length; i++) {
          plet.push(palette[i] << 8 | emissivePalette[i] & 255);
        }
      } else {
        for (let i = 0; i < palette.length; i++) {
          const [r, g, b] = palette[i];
          plet.push(r << 24 | g << 16 | b << 8 | emissivePalette[i] & 255);
        }
      }
      meshTexture.data = texture.data;
      meshTexture.width = texture.width;
      return meshTexture;
    }
    function rectanglesToMeshData(rectangles, textureMap, positions, extendEdge = false) {
      const meshData = schema_1.MeshDataSchema.alloc();
      const bias = extendEdge ? 1 : 0;
      for (let i = 0; i < 6; i++) {
        meshData.push({ vertices: [], uvs: [], sizes: [], uvFlags: [] });
      }
      for (let i = 0; i < rectangles.length; i++) {
        for (let j = 0; j < rectangles[i].length; j++) {
          const r = rectangles[i][j];
          const pos = positions.get(textureMap.get(r.texture.hash));
          const u0 = pos.x + bias;
          const v0 = pos.y + bias;
          const u1 = pos.x + pos.width - bias;
          const v1 = pos.y + pos.height - bias;
          meshData[i].vertices.push(r.x, r.y, r.z);
          meshData[i].sizes.push(r.width, r.height);
          meshData[i].uvs.push(u0, v0, u1, v1);
          const uvFlag = (
            // rotation and flipping steps:
            // 1. rotate the texture r.texture.rotation * 90 degree
            // 2. flip the texture if r.texture.flipped is true
            // 3. rotate the texture  pos.rotation * 90 degree
            // there are two rotate operations, so we can merge step 3 into step 1 to reduce one step
            // to achieve it, should reverse the second rotation and add it into the first rotation
            r.texture.rotation + (r.texture.flipped ? 4 - pos.rotation : pos.rotation) & 3 | r.texture.flipped << 2
          );
          const { uvFlags } = meshData[i];
          if (j & 1) {
            uvFlags[j >> 1] |= uvFlag;
          } else {
            uvFlags[j >> 1] = uvFlag << 4;
          }
        }
      }
      return meshData;
    }
    var Mesher = class {
      constructor(compress = true, extendEdge = false, surfaceOnly = false) {
        this.compress = compress;
        this.extendEdge = extendEdge;
        this.surfaceOnly = surfaceOnly;
        this.textureMap = /* @__PURE__ */ new Map();
        this.models = [];
        this.textureCache = null;
      }
      addModel(voxel, squashDimension = 3) {
        this.models.push(voxelToRectangles(voxel, this.textureMap, this.compress, this.extendEdge, this.surfaceOnly, squashDimension));
        this.textureCache = null;
      }
      getTextureData() {
        if (!this.textureCache) {
          this.textureCache = getTexture(this.textureMap);
        }
        return this.textureCache;
      }
      getMeshes(extendEdge = this.extendEdge) {
        const { positions } = this.getTextureData();
        return this.models.map((rectangles) => rectanglesToMeshData(rectangles, this.textureMap, positions, extendEdge));
      }
      getMesh(index, extendEdge = this.extendEdge) {
        const { positions } = this.getTextureData();
        return rectanglesToMeshData(this.models[index], this.textureMap, positions, extendEdge);
      }
      getTexture(palette, emissivePalette) {
        return textureToMeshTexture(this.getTextureData().texture, palette, emissivePalette);
      }
    };
    exports.Mesher = Mesher;
    async function voxelsToMeshes2(voxels, palette, emissivePalette, compress = true, extendEdge = true) {
      const mesher = new Mesher(compress, extendEdge, false);
      for (const voxel of voxels) {
        mesher.addModel(voxel);
      }
      return {
        meshes: mesher.getMeshes(),
        texture: await mesher.getTexture(palette, emissivePalette)
      };
    }
    function unpackTextureData2(texture, channels) {
      const { data, palette } = texture;
      const image = new Uint8Array(data.length * channels.length);
      for (let i = 0; i < data.length; i++) {
        const idx = i * channels.length;
        const color = palette[data[i]];
        for (let j = 0; j < channels.length; j++) {
          image[idx + j] = color >> channels[j] & 255;
        }
      }
      return image;
    }
    function unpackMeshData2(meshData, VertexDataType = Uint8Array, UVDataType = Uint16Array) {
      let nums = 0;
      for (let k = 0; k < 6; k++) {
        nums += meshData[k].sizes.length / 2;
      }
      const data = new VertexDataType(nums * 4 * 4);
      const uvData = new UVDataType(nums * 4 * 2);
      let ptr = 0;
      const swapPtrIdx = [1, 0, 0, 1, 1, 0];
      function pushData(x, y, z, normalCode, u, v) {
        const p = ptr++ ^ swapPtrIdx[normalCode];
        data[p * 4 + 0] = x;
        data[p * 4 + 1] = y;
        data[p * 4 + 2] = z;
        data[p * 4 + 3] = normalCode;
        uvData[p * 2 + 0] = u;
        uvData[p * 2 + 1] = v;
      }
      const uvFlagMap = [
        [0, 1, 2, 3],
        // flipped: false, rotation: 0
        [1, 3, 0, 2],
        // flipped: false, rotation: 1
        [3, 2, 1, 0],
        // flipped: false, rotation: 2
        [2, 0, 3, 1],
        // flipped: false, rotation: 3
        [0, 2, 1, 3],
        // flipped: true,  rotation: 0
        [2, 3, 0, 1],
        // flipped: true,  rotation: 1
        [3, 1, 2, 0],
        // flipped: true,  rotation: 2
        [1, 0, 3, 2]
        // flipped: true,  rotation: 3
      ];
      let lox = Infinity;
      let loy = Infinity;
      let loz = Infinity;
      let hix = -Infinity;
      let hiy = -Infinity;
      let hiz = -Infinity;
      for (let k = 0; k < 6; k++) {
        const p = meshData[k];
        const cnt = p.vertices.length / 3;
        for (let i = 0; i < cnt; i++) {
          const x0 = p.vertices[i * 3 + 0];
          const y0 = p.vertices[i * 3 + 1];
          const z0 = p.vertices[i * 3 + 2];
          const w = p.sizes[i * 2 + 0];
          const h = p.sizes[i * 2 + 1];
          const u0 = p.uvs[i * 4 + 0];
          const v0 = p.uvs[i * 4 + 1];
          const u1 = p.uvs[i * 4 + 2];
          const v1 = p.uvs[i * 4 + 3];
          const x1 = x0 + (k >= 2 ? w : 0);
          const y1 = y0 + (k <= 1 ? w : k >= 4 ? h : 0);
          const z1 = z0 + (k <= 3 ? h : 0);
          const uvFlagIdx = i;
          const uvFlag = uvFlagIdx & 1 ? p.uvFlags[uvFlagIdx >> 1] & 15 : p.uvFlags[uvFlagIdx >> 1] >> 4;
          const uvs = [
            [u0, v0],
            [u1, v0],
            [u0, v1],
            [u1, v1]
          ];
          lox = Math.min(lox, x0);
          hix = Math.max(hix, x1);
          loy = Math.min(loy, y0);
          hiy = Math.max(hiy, y1);
          loz = Math.min(loz, z0);
          hiz = Math.max(hiz, z1);
          const uvMap = uvFlagMap[uvFlag];
          if (k <= 1) {
            pushData(x0, y0, z0, k, ...uvs[uvMap[0]]);
            pushData(x0, y1, z0, k, ...uvs[uvMap[1]]);
            pushData(x0, y0, z1, k, ...uvs[uvMap[2]]);
            pushData(x0, y1, z1, k, ...uvs[uvMap[3]]);
          } else if (k <= 3) {
            pushData(x0, y0, z0, k, ...uvs[uvMap[0]]);
            pushData(x1, y0, z0, k, ...uvs[uvMap[1]]);
            pushData(x0, y0, z1, k, ...uvs[uvMap[2]]);
            pushData(x1, y0, z1, k, ...uvs[uvMap[3]]);
          } else {
            pushData(x0, y0, z0, k, ...uvs[uvMap[0]]);
            pushData(x1, y0, z0, k, ...uvs[uvMap[1]]);
            pushData(x0, y1, z0, k, ...uvs[uvMap[2]]);
            pushData(x1, y1, z0, k, ...uvs[uvMap[3]]);
          }
        }
      }
      return {
        meshData: data,
        uvData,
        count: nums * 6,
        // 1 rectangle = 3 triangles = 6 vertices
        lox,
        loy,
        loz,
        hix,
        hiy,
        hiz
      };
    }
    function getVertexCount(rectangles) {
      const nums = rectangles.reduce((prev, cur) => {
        return prev + cur.length;
      }, 0);
      return nums * 6;
    }
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/common.js
var require_common = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/common.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.setMatrixArrayType = setMatrixArrayType;
    exports.toRadian = toRadian;
    exports.equals = equals;
    exports.RANDOM = exports.ARRAY_TYPE = exports.EPSILON = void 0;
    var EPSILON = 1e-6;
    exports.EPSILON = EPSILON;
    var ARRAY_TYPE = typeof Float32Array !== "undefined" ? Float32Array : Array;
    exports.ARRAY_TYPE = ARRAY_TYPE;
    var RANDOM = Math.random;
    exports.RANDOM = RANDOM;
    function setMatrixArrayType(type) {
      exports.ARRAY_TYPE = ARRAY_TYPE = type;
    }
    var degree = Math.PI / 180;
    function toRadian(a) {
      return a * degree;
    }
    function equals(a, b) {
      return Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
    }
    if (!Math.hypot) Math.hypot = function() {
      var y = 0, i = arguments.length;
      while (i--) {
        y += arguments[i] * arguments[i];
      }
      return Math.sqrt(y);
    };
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/mat2.js
var require_mat2 = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/mat2.js"(exports) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof = function _typeof2(obj2) {
          return typeof obj2;
        };
      } else {
        _typeof = function _typeof2(obj2) {
          return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
        };
      }
      return _typeof(obj);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.create = create;
    exports.clone = clone;
    exports.copy = copy;
    exports.identity = identity;
    exports.fromValues = fromValues;
    exports.set = set;
    exports.transpose = transpose;
    exports.invert = invert;
    exports.adjoint = adjoint;
    exports.determinant = determinant;
    exports.multiply = multiply;
    exports.rotate = rotate;
    exports.scale = scale;
    exports.fromRotation = fromRotation;
    exports.fromScaling = fromScaling;
    exports.str = str;
    exports.frob = frob;
    exports.LDU = LDU;
    exports.add = add;
    exports.subtract = subtract;
    exports.exactEquals = exactEquals;
    exports.equals = equals;
    exports.multiplyScalar = multiplyScalar;
    exports.multiplyScalarAndAdd = multiplyScalarAndAdd;
    exports.sub = exports.mul = void 0;
    var glMatrix = _interopRequireWildcard(require_common());
    function _getRequireWildcardCache(nodeInterop) {
      if (typeof WeakMap !== "function") return null;
      var cacheBabelInterop = /* @__PURE__ */ new WeakMap();
      var cacheNodeInterop = /* @__PURE__ */ new WeakMap();
      return (_getRequireWildcardCache = function _getRequireWildcardCache2(nodeInterop2) {
        return nodeInterop2 ? cacheNodeInterop : cacheBabelInterop;
      })(nodeInterop);
    }
    function _interopRequireWildcard(obj, nodeInterop) {
      if (!nodeInterop && obj && obj.__esModule) {
        return obj;
      }
      if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") {
        return { "default": obj };
      }
      var cache = _getRequireWildcardCache(nodeInterop);
      if (cache && cache.has(obj)) {
        return cache.get(obj);
      }
      var newObj = {};
      var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var key in obj) {
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
          var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
          if (desc && (desc.get || desc.set)) {
            Object.defineProperty(newObj, key, desc);
          } else {
            newObj[key] = obj[key];
          }
        }
      }
      newObj["default"] = obj;
      if (cache) {
        cache.set(obj, newObj);
      }
      return newObj;
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(4);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[1] = 0;
        out[2] = 0;
      }
      out[0] = 1;
      out[3] = 1;
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(4);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    }
    function identity(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return out;
    }
    function fromValues(m00, m01, m10, m11) {
      var out = new glMatrix.ARRAY_TYPE(4);
      out[0] = m00;
      out[1] = m01;
      out[2] = m10;
      out[3] = m11;
      return out;
    }
    function set(out, m00, m01, m10, m11) {
      out[0] = m00;
      out[1] = m01;
      out[2] = m10;
      out[3] = m11;
      return out;
    }
    function transpose(out, a) {
      if (out === a) {
        var a1 = a[1];
        out[1] = a[2];
        out[2] = a1;
      } else {
        out[0] = a[0];
        out[1] = a[2];
        out[2] = a[1];
        out[3] = a[3];
      }
      return out;
    }
    function invert(out, a) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var det = a0 * a3 - a2 * a1;
      if (!det) {
        return null;
      }
      det = 1 / det;
      out[0] = a3 * det;
      out[1] = -a1 * det;
      out[2] = -a2 * det;
      out[3] = a0 * det;
      return out;
    }
    function adjoint(out, a) {
      var a0 = a[0];
      out[0] = a[3];
      out[1] = -a[1];
      out[2] = -a[2];
      out[3] = a0;
      return out;
    }
    function determinant(a) {
      return a[0] * a[3] - a[2] * a[1];
    }
    function multiply(out, a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      out[0] = a0 * b0 + a2 * b1;
      out[1] = a1 * b0 + a3 * b1;
      out[2] = a0 * b2 + a2 * b3;
      out[3] = a1 * b2 + a3 * b3;
      return out;
    }
    function rotate(out, a, rad) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = a0 * c + a2 * s;
      out[1] = a1 * c + a3 * s;
      out[2] = a0 * -s + a2 * c;
      out[3] = a1 * -s + a3 * c;
      return out;
    }
    function scale(out, a, v) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var v0 = v[0], v1 = v[1];
      out[0] = a0 * v0;
      out[1] = a1 * v0;
      out[2] = a2 * v1;
      out[3] = a3 * v1;
      return out;
    }
    function fromRotation(out, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = c;
      out[1] = s;
      out[2] = -s;
      out[3] = c;
      return out;
    }
    function fromScaling(out, v) {
      out[0] = v[0];
      out[1] = 0;
      out[2] = 0;
      out[3] = v[1];
      return out;
    }
    function str(a) {
      return "mat2(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ")";
    }
    function frob(a) {
      return Math.hypot(a[0], a[1], a[2], a[3]);
    }
    function LDU(L, D, U, a) {
      L[2] = a[2] / a[0];
      U[0] = a[0];
      U[1] = a[1];
      U[3] = a[3] - L[2] * U[1];
      return [L, D, U];
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      out[3] = a[3] - b[3];
      return out;
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3));
    }
    function multiplyScalar(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      return out;
    }
    function multiplyScalarAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      out[3] = a[3] + b[3] * scale2;
      return out;
    }
    var mul = multiply;
    exports.mul = mul;
    var sub = subtract;
    exports.sub = sub;
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/mat2d.js
var require_mat2d = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/mat2d.js"(exports) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof = function _typeof2(obj2) {
          return typeof obj2;
        };
      } else {
        _typeof = function _typeof2(obj2) {
          return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
        };
      }
      return _typeof(obj);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.create = create;
    exports.clone = clone;
    exports.copy = copy;
    exports.identity = identity;
    exports.fromValues = fromValues;
    exports.set = set;
    exports.invert = invert;
    exports.determinant = determinant;
    exports.multiply = multiply;
    exports.rotate = rotate;
    exports.scale = scale;
    exports.translate = translate;
    exports.fromRotation = fromRotation;
    exports.fromScaling = fromScaling;
    exports.fromTranslation = fromTranslation;
    exports.str = str;
    exports.frob = frob;
    exports.add = add;
    exports.subtract = subtract;
    exports.multiplyScalar = multiplyScalar;
    exports.multiplyScalarAndAdd = multiplyScalarAndAdd;
    exports.exactEquals = exactEquals;
    exports.equals = equals;
    exports.sub = exports.mul = void 0;
    var glMatrix = _interopRequireWildcard(require_common());
    function _getRequireWildcardCache(nodeInterop) {
      if (typeof WeakMap !== "function") return null;
      var cacheBabelInterop = /* @__PURE__ */ new WeakMap();
      var cacheNodeInterop = /* @__PURE__ */ new WeakMap();
      return (_getRequireWildcardCache = function _getRequireWildcardCache2(nodeInterop2) {
        return nodeInterop2 ? cacheNodeInterop : cacheBabelInterop;
      })(nodeInterop);
    }
    function _interopRequireWildcard(obj, nodeInterop) {
      if (!nodeInterop && obj && obj.__esModule) {
        return obj;
      }
      if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") {
        return { "default": obj };
      }
      var cache = _getRequireWildcardCache(nodeInterop);
      if (cache && cache.has(obj)) {
        return cache.get(obj);
      }
      var newObj = {};
      var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var key in obj) {
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
          var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
          if (desc && (desc.get || desc.set)) {
            Object.defineProperty(newObj, key, desc);
          } else {
            newObj[key] = obj[key];
          }
        }
      }
      newObj["default"] = obj;
      if (cache) {
        cache.set(obj, newObj);
      }
      return newObj;
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(6);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[1] = 0;
        out[2] = 0;
        out[4] = 0;
        out[5] = 0;
      }
      out[0] = 1;
      out[3] = 1;
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(6);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      return out;
    }
    function identity(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      out[4] = 0;
      out[5] = 0;
      return out;
    }
    function fromValues(a, b, c, d, tx, ty) {
      var out = new glMatrix.ARRAY_TYPE(6);
      out[0] = a;
      out[1] = b;
      out[2] = c;
      out[3] = d;
      out[4] = tx;
      out[5] = ty;
      return out;
    }
    function set(out, a, b, c, d, tx, ty) {
      out[0] = a;
      out[1] = b;
      out[2] = c;
      out[3] = d;
      out[4] = tx;
      out[5] = ty;
      return out;
    }
    function invert(out, a) {
      var aa = a[0], ab = a[1], ac = a[2], ad = a[3];
      var atx = a[4], aty = a[5];
      var det = aa * ad - ab * ac;
      if (!det) {
        return null;
      }
      det = 1 / det;
      out[0] = ad * det;
      out[1] = -ab * det;
      out[2] = -ac * det;
      out[3] = aa * det;
      out[4] = (ac * aty - ad * atx) * det;
      out[5] = (ab * atx - aa * aty) * det;
      return out;
    }
    function determinant(a) {
      return a[0] * a[3] - a[1] * a[2];
    }
    function multiply(out, a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5];
      out[0] = a0 * b0 + a2 * b1;
      out[1] = a1 * b0 + a3 * b1;
      out[2] = a0 * b2 + a2 * b3;
      out[3] = a1 * b2 + a3 * b3;
      out[4] = a0 * b4 + a2 * b5 + a4;
      out[5] = a1 * b4 + a3 * b5 + a5;
      return out;
    }
    function rotate(out, a, rad) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = a0 * c + a2 * s;
      out[1] = a1 * c + a3 * s;
      out[2] = a0 * -s + a2 * c;
      out[3] = a1 * -s + a3 * c;
      out[4] = a4;
      out[5] = a5;
      return out;
    }
    function scale(out, a, v) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
      var v0 = v[0], v1 = v[1];
      out[0] = a0 * v0;
      out[1] = a1 * v0;
      out[2] = a2 * v1;
      out[3] = a3 * v1;
      out[4] = a4;
      out[5] = a5;
      return out;
    }
    function translate(out, a, v) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
      var v0 = v[0], v1 = v[1];
      out[0] = a0;
      out[1] = a1;
      out[2] = a2;
      out[3] = a3;
      out[4] = a0 * v0 + a2 * v1 + a4;
      out[5] = a1 * v0 + a3 * v1 + a5;
      return out;
    }
    function fromRotation(out, rad) {
      var s = Math.sin(rad), c = Math.cos(rad);
      out[0] = c;
      out[1] = s;
      out[2] = -s;
      out[3] = c;
      out[4] = 0;
      out[5] = 0;
      return out;
    }
    function fromScaling(out, v) {
      out[0] = v[0];
      out[1] = 0;
      out[2] = 0;
      out[3] = v[1];
      out[4] = 0;
      out[5] = 0;
      return out;
    }
    function fromTranslation(out, v) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      out[4] = v[0];
      out[5] = v[1];
      return out;
    }
    function str(a) {
      return "mat2d(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ")";
    }
    function frob(a) {
      return Math.hypot(a[0], a[1], a[2], a[3], a[4], a[5], 1);
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      out[4] = a[4] + b[4];
      out[5] = a[5] + b[5];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      out[3] = a[3] - b[3];
      out[4] = a[4] - b[4];
      out[5] = a[5] - b[5];
      return out;
    }
    function multiplyScalar(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      out[4] = a[4] * b;
      out[5] = a[5] * b;
      return out;
    }
    function multiplyScalarAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      out[3] = a[3] + b[3] * scale2;
      out[4] = a[4] + b[4] * scale2;
      out[5] = a[5] + b[5] * scale2;
      return out;
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= glMatrix.EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= glMatrix.EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5));
    }
    var mul = multiply;
    exports.mul = mul;
    var sub = subtract;
    exports.sub = sub;
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/mat3.js
var require_mat3 = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/mat3.js"(exports) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof = function _typeof2(obj2) {
          return typeof obj2;
        };
      } else {
        _typeof = function _typeof2(obj2) {
          return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
        };
      }
      return _typeof(obj);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.create = create;
    exports.fromMat4 = fromMat4;
    exports.clone = clone;
    exports.copy = copy;
    exports.fromValues = fromValues;
    exports.set = set;
    exports.identity = identity;
    exports.transpose = transpose;
    exports.invert = invert;
    exports.adjoint = adjoint;
    exports.determinant = determinant;
    exports.multiply = multiply;
    exports.translate = translate;
    exports.rotate = rotate;
    exports.scale = scale;
    exports.fromTranslation = fromTranslation;
    exports.fromRotation = fromRotation;
    exports.fromScaling = fromScaling;
    exports.fromMat2d = fromMat2d;
    exports.fromQuat = fromQuat;
    exports.normalFromMat4 = normalFromMat4;
    exports.projection = projection;
    exports.str = str;
    exports.frob = frob;
    exports.add = add;
    exports.subtract = subtract;
    exports.multiplyScalar = multiplyScalar;
    exports.multiplyScalarAndAdd = multiplyScalarAndAdd;
    exports.exactEquals = exactEquals;
    exports.equals = equals;
    exports.sub = exports.mul = void 0;
    var glMatrix = _interopRequireWildcard(require_common());
    function _getRequireWildcardCache(nodeInterop) {
      if (typeof WeakMap !== "function") return null;
      var cacheBabelInterop = /* @__PURE__ */ new WeakMap();
      var cacheNodeInterop = /* @__PURE__ */ new WeakMap();
      return (_getRequireWildcardCache = function _getRequireWildcardCache2(nodeInterop2) {
        return nodeInterop2 ? cacheNodeInterop : cacheBabelInterop;
      })(nodeInterop);
    }
    function _interopRequireWildcard(obj, nodeInterop) {
      if (!nodeInterop && obj && obj.__esModule) {
        return obj;
      }
      if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") {
        return { "default": obj };
      }
      var cache = _getRequireWildcardCache(nodeInterop);
      if (cache && cache.has(obj)) {
        return cache.get(obj);
      }
      var newObj = {};
      var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var key in obj) {
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
          var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
          if (desc && (desc.get || desc.set)) {
            Object.defineProperty(newObj, key, desc);
          } else {
            newObj[key] = obj[key];
          }
        }
      }
      newObj["default"] = obj;
      if (cache) {
        cache.set(obj, newObj);
      }
      return newObj;
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(9);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
        out[5] = 0;
        out[6] = 0;
        out[7] = 0;
      }
      out[0] = 1;
      out[4] = 1;
      out[8] = 1;
      return out;
    }
    function fromMat4(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[4];
      out[4] = a[5];
      out[5] = a[6];
      out[6] = a[8];
      out[7] = a[9];
      out[8] = a[10];
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(9);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      return out;
    }
    function fromValues(m00, m01, m02, m10, m11, m12, m20, m21, m22) {
      var out = new glMatrix.ARRAY_TYPE(9);
      out[0] = m00;
      out[1] = m01;
      out[2] = m02;
      out[3] = m10;
      out[4] = m11;
      out[5] = m12;
      out[6] = m20;
      out[7] = m21;
      out[8] = m22;
      return out;
    }
    function set(out, m00, m01, m02, m10, m11, m12, m20, m21, m22) {
      out[0] = m00;
      out[1] = m01;
      out[2] = m02;
      out[3] = m10;
      out[4] = m11;
      out[5] = m12;
      out[6] = m20;
      out[7] = m21;
      out[8] = m22;
      return out;
    }
    function identity(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 1;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      out[8] = 1;
      return out;
    }
    function transpose(out, a) {
      if (out === a) {
        var a01 = a[1], a02 = a[2], a12 = a[5];
        out[1] = a[3];
        out[2] = a[6];
        out[3] = a01;
        out[5] = a[7];
        out[6] = a02;
        out[7] = a12;
      } else {
        out[0] = a[0];
        out[1] = a[3];
        out[2] = a[6];
        out[3] = a[1];
        out[4] = a[4];
        out[5] = a[7];
        out[6] = a[2];
        out[7] = a[5];
        out[8] = a[8];
      }
      return out;
    }
    function invert(out, a) {
      var a00 = a[0], a01 = a[1], a02 = a[2];
      var a10 = a[3], a11 = a[4], a12 = a[5];
      var a20 = a[6], a21 = a[7], a22 = a[8];
      var b01 = a22 * a11 - a12 * a21;
      var b11 = -a22 * a10 + a12 * a20;
      var b21 = a21 * a10 - a11 * a20;
      var det = a00 * b01 + a01 * b11 + a02 * b21;
      if (!det) {
        return null;
      }
      det = 1 / det;
      out[0] = b01 * det;
      out[1] = (-a22 * a01 + a02 * a21) * det;
      out[2] = (a12 * a01 - a02 * a11) * det;
      out[3] = b11 * det;
      out[4] = (a22 * a00 - a02 * a20) * det;
      out[5] = (-a12 * a00 + a02 * a10) * det;
      out[6] = b21 * det;
      out[7] = (-a21 * a00 + a01 * a20) * det;
      out[8] = (a11 * a00 - a01 * a10) * det;
      return out;
    }
    function adjoint(out, a) {
      var a00 = a[0], a01 = a[1], a02 = a[2];
      var a10 = a[3], a11 = a[4], a12 = a[5];
      var a20 = a[6], a21 = a[7], a22 = a[8];
      out[0] = a11 * a22 - a12 * a21;
      out[1] = a02 * a21 - a01 * a22;
      out[2] = a01 * a12 - a02 * a11;
      out[3] = a12 * a20 - a10 * a22;
      out[4] = a00 * a22 - a02 * a20;
      out[5] = a02 * a10 - a00 * a12;
      out[6] = a10 * a21 - a11 * a20;
      out[7] = a01 * a20 - a00 * a21;
      out[8] = a00 * a11 - a01 * a10;
      return out;
    }
    function determinant(a) {
      var a00 = a[0], a01 = a[1], a02 = a[2];
      var a10 = a[3], a11 = a[4], a12 = a[5];
      var a20 = a[6], a21 = a[7], a22 = a[8];
      return a00 * (a22 * a11 - a12 * a21) + a01 * (-a22 * a10 + a12 * a20) + a02 * (a21 * a10 - a11 * a20);
    }
    function multiply(out, a, b) {
      var a00 = a[0], a01 = a[1], a02 = a[2];
      var a10 = a[3], a11 = a[4], a12 = a[5];
      var a20 = a[6], a21 = a[7], a22 = a[8];
      var b00 = b[0], b01 = b[1], b02 = b[2];
      var b10 = b[3], b11 = b[4], b12 = b[5];
      var b20 = b[6], b21 = b[7], b22 = b[8];
      out[0] = b00 * a00 + b01 * a10 + b02 * a20;
      out[1] = b00 * a01 + b01 * a11 + b02 * a21;
      out[2] = b00 * a02 + b01 * a12 + b02 * a22;
      out[3] = b10 * a00 + b11 * a10 + b12 * a20;
      out[4] = b10 * a01 + b11 * a11 + b12 * a21;
      out[5] = b10 * a02 + b11 * a12 + b12 * a22;
      out[6] = b20 * a00 + b21 * a10 + b22 * a20;
      out[7] = b20 * a01 + b21 * a11 + b22 * a21;
      out[8] = b20 * a02 + b21 * a12 + b22 * a22;
      return out;
    }
    function translate(out, a, v) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8], x = v[0], y = v[1];
      out[0] = a00;
      out[1] = a01;
      out[2] = a02;
      out[3] = a10;
      out[4] = a11;
      out[5] = a12;
      out[6] = x * a00 + y * a10 + a20;
      out[7] = x * a01 + y * a11 + a21;
      out[8] = x * a02 + y * a12 + a22;
      return out;
    }
    function rotate(out, a, rad) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8], s = Math.sin(rad), c = Math.cos(rad);
      out[0] = c * a00 + s * a10;
      out[1] = c * a01 + s * a11;
      out[2] = c * a02 + s * a12;
      out[3] = c * a10 - s * a00;
      out[4] = c * a11 - s * a01;
      out[5] = c * a12 - s * a02;
      out[6] = a20;
      out[7] = a21;
      out[8] = a22;
      return out;
    }
    function scale(out, a, v) {
      var x = v[0], y = v[1];
      out[0] = x * a[0];
      out[1] = x * a[1];
      out[2] = x * a[2];
      out[3] = y * a[3];
      out[4] = y * a[4];
      out[5] = y * a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      return out;
    }
    function fromTranslation(out, v) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 1;
      out[5] = 0;
      out[6] = v[0];
      out[7] = v[1];
      out[8] = 1;
      return out;
    }
    function fromRotation(out, rad) {
      var s = Math.sin(rad), c = Math.cos(rad);
      out[0] = c;
      out[1] = s;
      out[2] = 0;
      out[3] = -s;
      out[4] = c;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      out[8] = 1;
      return out;
    }
    function fromScaling(out, v) {
      out[0] = v[0];
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = v[1];
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      out[8] = 1;
      return out;
    }
    function fromMat2d(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = 0;
      out[3] = a[2];
      out[4] = a[3];
      out[5] = 0;
      out[6] = a[4];
      out[7] = a[5];
      out[8] = 1;
      return out;
    }
    function fromQuat(out, q) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x;
      var y2 = y + y;
      var z2 = z + z;
      var xx = x * x2;
      var yx = y * x2;
      var yy = y * y2;
      var zx = z * x2;
      var zy = z * y2;
      var zz = z * z2;
      var wx = w * x2;
      var wy = w * y2;
      var wz = w * z2;
      out[0] = 1 - yy - zz;
      out[3] = yx - wz;
      out[6] = zx + wy;
      out[1] = yx + wz;
      out[4] = 1 - xx - zz;
      out[7] = zy - wx;
      out[2] = zx - wy;
      out[5] = zy + wx;
      out[8] = 1 - xx - yy;
      return out;
    }
    function normalFromMat4(out, a) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      var b00 = a00 * a11 - a01 * a10;
      var b01 = a00 * a12 - a02 * a10;
      var b02 = a00 * a13 - a03 * a10;
      var b03 = a01 * a12 - a02 * a11;
      var b04 = a01 * a13 - a03 * a11;
      var b05 = a02 * a13 - a03 * a12;
      var b06 = a20 * a31 - a21 * a30;
      var b07 = a20 * a32 - a22 * a30;
      var b08 = a20 * a33 - a23 * a30;
      var b09 = a21 * a32 - a22 * a31;
      var b10 = a21 * a33 - a23 * a31;
      var b11 = a22 * a33 - a23 * a32;
      var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) {
        return null;
      }
      det = 1 / det;
      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      out[1] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      out[2] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      out[3] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[4] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[5] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[6] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      out[7] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      out[8] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      return out;
    }
    function projection(out, width, height) {
      out[0] = 2 / width;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = -2 / height;
      out[5] = 0;
      out[6] = -1;
      out[7] = 1;
      out[8] = 1;
      return out;
    }
    function str(a) {
      return "mat3(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ", " + a[6] + ", " + a[7] + ", " + a[8] + ")";
    }
    function frob(a) {
      return Math.hypot(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]);
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      out[4] = a[4] + b[4];
      out[5] = a[5] + b[5];
      out[6] = a[6] + b[6];
      out[7] = a[7] + b[7];
      out[8] = a[8] + b[8];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      out[3] = a[3] - b[3];
      out[4] = a[4] - b[4];
      out[5] = a[5] - b[5];
      out[6] = a[6] - b[6];
      out[7] = a[7] - b[7];
      out[8] = a[8] - b[8];
      return out;
    }
    function multiplyScalar(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      out[4] = a[4] * b;
      out[5] = a[5] * b;
      out[6] = a[6] * b;
      out[7] = a[7] * b;
      out[8] = a[8] * b;
      return out;
    }
    function multiplyScalarAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      out[3] = a[3] + b[3] * scale2;
      out[4] = a[4] + b[4] * scale2;
      out[5] = a[5] + b[5] * scale2;
      out[6] = a[6] + b[6] * scale2;
      out[7] = a[7] + b[7] * scale2;
      out[8] = a[8] + b[8] * scale2;
      return out;
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7] && a[8] === b[8];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7], a8 = a[8];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7], b8 = b[8];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= glMatrix.EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= glMatrix.EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5)) && Math.abs(a6 - b6) <= glMatrix.EPSILON * Math.max(1, Math.abs(a6), Math.abs(b6)) && Math.abs(a7 - b7) <= glMatrix.EPSILON * Math.max(1, Math.abs(a7), Math.abs(b7)) && Math.abs(a8 - b8) <= glMatrix.EPSILON * Math.max(1, Math.abs(a8), Math.abs(b8));
    }
    var mul = multiply;
    exports.mul = mul;
    var sub = subtract;
    exports.sub = sub;
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/mat4.js
var require_mat4 = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/mat4.js"(exports) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof = function _typeof2(obj2) {
          return typeof obj2;
        };
      } else {
        _typeof = function _typeof2(obj2) {
          return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
        };
      }
      return _typeof(obj);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.create = create;
    exports.clone = clone;
    exports.copy = copy;
    exports.fromValues = fromValues;
    exports.set = set;
    exports.identity = identity;
    exports.transpose = transpose;
    exports.invert = invert;
    exports.adjoint = adjoint;
    exports.determinant = determinant;
    exports.multiply = multiply;
    exports.translate = translate;
    exports.scale = scale;
    exports.rotate = rotate;
    exports.rotateX = rotateX;
    exports.rotateY = rotateY;
    exports.rotateZ = rotateZ;
    exports.fromTranslation = fromTranslation;
    exports.fromScaling = fromScaling;
    exports.fromRotation = fromRotation;
    exports.fromXRotation = fromXRotation;
    exports.fromYRotation = fromYRotation;
    exports.fromZRotation = fromZRotation;
    exports.fromRotationTranslation = fromRotationTranslation;
    exports.fromQuat2 = fromQuat2;
    exports.getTranslation = getTranslation;
    exports.getScaling = getScaling;
    exports.getRotation = getRotation;
    exports.fromRotationTranslationScale = fromRotationTranslationScale;
    exports.fromRotationTranslationScaleOrigin = fromRotationTranslationScaleOrigin;
    exports.fromQuat = fromQuat;
    exports.frustum = frustum;
    exports.perspectiveNO = perspectiveNO;
    exports.perspectiveZO = perspectiveZO;
    exports.perspectiveFromFieldOfView = perspectiveFromFieldOfView;
    exports.orthoNO = orthoNO;
    exports.orthoZO = orthoZO;
    exports.lookAt = lookAt;
    exports.targetTo = targetTo;
    exports.str = str;
    exports.frob = frob;
    exports.add = add;
    exports.subtract = subtract;
    exports.multiplyScalar = multiplyScalar;
    exports.multiplyScalarAndAdd = multiplyScalarAndAdd;
    exports.exactEquals = exactEquals;
    exports.equals = equals;
    exports.sub = exports.mul = exports.ortho = exports.perspective = void 0;
    var glMatrix = _interopRequireWildcard(require_common());
    function _getRequireWildcardCache(nodeInterop) {
      if (typeof WeakMap !== "function") return null;
      var cacheBabelInterop = /* @__PURE__ */ new WeakMap();
      var cacheNodeInterop = /* @__PURE__ */ new WeakMap();
      return (_getRequireWildcardCache = function _getRequireWildcardCache2(nodeInterop2) {
        return nodeInterop2 ? cacheNodeInterop : cacheBabelInterop;
      })(nodeInterop);
    }
    function _interopRequireWildcard(obj, nodeInterop) {
      if (!nodeInterop && obj && obj.__esModule) {
        return obj;
      }
      if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") {
        return { "default": obj };
      }
      var cache = _getRequireWildcardCache(nodeInterop);
      if (cache && cache.has(obj)) {
        return cache.get(obj);
      }
      var newObj = {};
      var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var key in obj) {
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
          var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
          if (desc && (desc.get || desc.set)) {
            Object.defineProperty(newObj, key, desc);
          } else {
            newObj[key] = obj[key];
          }
        }
      }
      newObj["default"] = obj;
      if (cache) {
        cache.set(obj, newObj);
      }
      return newObj;
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(16);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
        out[4] = 0;
        out[6] = 0;
        out[7] = 0;
        out[8] = 0;
        out[9] = 0;
        out[11] = 0;
        out[12] = 0;
        out[13] = 0;
        out[14] = 0;
      }
      out[0] = 1;
      out[5] = 1;
      out[10] = 1;
      out[15] = 1;
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(16);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      out[9] = a[9];
      out[10] = a[10];
      out[11] = a[11];
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      out[9] = a[9];
      out[10] = a[10];
      out[11] = a[11];
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
      return out;
    }
    function fromValues(m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33) {
      var out = new glMatrix.ARRAY_TYPE(16);
      out[0] = m00;
      out[1] = m01;
      out[2] = m02;
      out[3] = m03;
      out[4] = m10;
      out[5] = m11;
      out[6] = m12;
      out[7] = m13;
      out[8] = m20;
      out[9] = m21;
      out[10] = m22;
      out[11] = m23;
      out[12] = m30;
      out[13] = m31;
      out[14] = m32;
      out[15] = m33;
      return out;
    }
    function set(out, m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33) {
      out[0] = m00;
      out[1] = m01;
      out[2] = m02;
      out[3] = m03;
      out[4] = m10;
      out[5] = m11;
      out[6] = m12;
      out[7] = m13;
      out[8] = m20;
      out[9] = m21;
      out[10] = m22;
      out[11] = m23;
      out[12] = m30;
      out[13] = m31;
      out[14] = m32;
      out[15] = m33;
      return out;
    }
    function identity(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = 1;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = 1;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function transpose(out, a) {
      if (out === a) {
        var a01 = a[1], a02 = a[2], a03 = a[3];
        var a12 = a[6], a13 = a[7];
        var a23 = a[11];
        out[1] = a[4];
        out[2] = a[8];
        out[3] = a[12];
        out[4] = a01;
        out[6] = a[9];
        out[7] = a[13];
        out[8] = a02;
        out[9] = a12;
        out[11] = a[14];
        out[12] = a03;
        out[13] = a13;
        out[14] = a23;
      } else {
        out[0] = a[0];
        out[1] = a[4];
        out[2] = a[8];
        out[3] = a[12];
        out[4] = a[1];
        out[5] = a[5];
        out[6] = a[9];
        out[7] = a[13];
        out[8] = a[2];
        out[9] = a[6];
        out[10] = a[10];
        out[11] = a[14];
        out[12] = a[3];
        out[13] = a[7];
        out[14] = a[11];
        out[15] = a[15];
      }
      return out;
    }
    function invert(out, a) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      var b00 = a00 * a11 - a01 * a10;
      var b01 = a00 * a12 - a02 * a10;
      var b02 = a00 * a13 - a03 * a10;
      var b03 = a01 * a12 - a02 * a11;
      var b04 = a01 * a13 - a03 * a11;
      var b05 = a02 * a13 - a03 * a12;
      var b06 = a20 * a31 - a21 * a30;
      var b07 = a20 * a32 - a22 * a30;
      var b08 = a20 * a33 - a23 * a30;
      var b09 = a21 * a32 - a22 * a31;
      var b10 = a21 * a33 - a23 * a31;
      var b11 = a22 * a33 - a23 * a32;
      var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) {
        return null;
      }
      det = 1 / det;
      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return out;
    }
    function adjoint(out, a) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      out[0] = a11 * (a22 * a33 - a23 * a32) - a21 * (a12 * a33 - a13 * a32) + a31 * (a12 * a23 - a13 * a22);
      out[1] = -(a01 * (a22 * a33 - a23 * a32) - a21 * (a02 * a33 - a03 * a32) + a31 * (a02 * a23 - a03 * a22));
      out[2] = a01 * (a12 * a33 - a13 * a32) - a11 * (a02 * a33 - a03 * a32) + a31 * (a02 * a13 - a03 * a12);
      out[3] = -(a01 * (a12 * a23 - a13 * a22) - a11 * (a02 * a23 - a03 * a22) + a21 * (a02 * a13 - a03 * a12));
      out[4] = -(a10 * (a22 * a33 - a23 * a32) - a20 * (a12 * a33 - a13 * a32) + a30 * (a12 * a23 - a13 * a22));
      out[5] = a00 * (a22 * a33 - a23 * a32) - a20 * (a02 * a33 - a03 * a32) + a30 * (a02 * a23 - a03 * a22);
      out[6] = -(a00 * (a12 * a33 - a13 * a32) - a10 * (a02 * a33 - a03 * a32) + a30 * (a02 * a13 - a03 * a12));
      out[7] = a00 * (a12 * a23 - a13 * a22) - a10 * (a02 * a23 - a03 * a22) + a20 * (a02 * a13 - a03 * a12);
      out[8] = a10 * (a21 * a33 - a23 * a31) - a20 * (a11 * a33 - a13 * a31) + a30 * (a11 * a23 - a13 * a21);
      out[9] = -(a00 * (a21 * a33 - a23 * a31) - a20 * (a01 * a33 - a03 * a31) + a30 * (a01 * a23 - a03 * a21));
      out[10] = a00 * (a11 * a33 - a13 * a31) - a10 * (a01 * a33 - a03 * a31) + a30 * (a01 * a13 - a03 * a11);
      out[11] = -(a00 * (a11 * a23 - a13 * a21) - a10 * (a01 * a23 - a03 * a21) + a20 * (a01 * a13 - a03 * a11));
      out[12] = -(a10 * (a21 * a32 - a22 * a31) - a20 * (a11 * a32 - a12 * a31) + a30 * (a11 * a22 - a12 * a21));
      out[13] = a00 * (a21 * a32 - a22 * a31) - a20 * (a01 * a32 - a02 * a31) + a30 * (a01 * a22 - a02 * a21);
      out[14] = -(a00 * (a11 * a32 - a12 * a31) - a10 * (a01 * a32 - a02 * a31) + a30 * (a01 * a12 - a02 * a11));
      out[15] = a00 * (a11 * a22 - a12 * a21) - a10 * (a01 * a22 - a02 * a21) + a20 * (a01 * a12 - a02 * a11);
      return out;
    }
    function determinant(a) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      var b00 = a00 * a11 - a01 * a10;
      var b01 = a00 * a12 - a02 * a10;
      var b02 = a00 * a13 - a03 * a10;
      var b03 = a01 * a12 - a02 * a11;
      var b04 = a01 * a13 - a03 * a11;
      var b05 = a02 * a13 - a03 * a12;
      var b06 = a20 * a31 - a21 * a30;
      var b07 = a20 * a32 - a22 * a30;
      var b08 = a20 * a33 - a23 * a30;
      var b09 = a21 * a32 - a22 * a31;
      var b10 = a21 * a33 - a23 * a31;
      var b11 = a22 * a33 - a23 * a32;
      return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    }
    function multiply(out, a, b) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[4];
      b1 = b[5];
      b2 = b[6];
      b3 = b[7];
      out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[8];
      b1 = b[9];
      b2 = b[10];
      b3 = b[11];
      out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[12];
      b1 = b[13];
      b2 = b[14];
      b3 = b[15];
      out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      return out;
    }
    function translate(out, a, v) {
      var x = v[0], y = v[1], z = v[2];
      var a00, a01, a02, a03;
      var a10, a11, a12, a13;
      var a20, a21, a22, a23;
      if (a === out) {
        out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
        out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
        out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
        out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
      } else {
        a00 = a[0];
        a01 = a[1];
        a02 = a[2];
        a03 = a[3];
        a10 = a[4];
        a11 = a[5];
        a12 = a[6];
        a13 = a[7];
        a20 = a[8];
        a21 = a[9];
        a22 = a[10];
        a23 = a[11];
        out[0] = a00;
        out[1] = a01;
        out[2] = a02;
        out[3] = a03;
        out[4] = a10;
        out[5] = a11;
        out[6] = a12;
        out[7] = a13;
        out[8] = a20;
        out[9] = a21;
        out[10] = a22;
        out[11] = a23;
        out[12] = a00 * x + a10 * y + a20 * z + a[12];
        out[13] = a01 * x + a11 * y + a21 * z + a[13];
        out[14] = a02 * x + a12 * y + a22 * z + a[14];
        out[15] = a03 * x + a13 * y + a23 * z + a[15];
      }
      return out;
    }
    function scale(out, a, v) {
      var x = v[0], y = v[1], z = v[2];
      out[0] = a[0] * x;
      out[1] = a[1] * x;
      out[2] = a[2] * x;
      out[3] = a[3] * x;
      out[4] = a[4] * y;
      out[5] = a[5] * y;
      out[6] = a[6] * y;
      out[7] = a[7] * y;
      out[8] = a[8] * z;
      out[9] = a[9] * z;
      out[10] = a[10] * z;
      out[11] = a[11] * z;
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
      return out;
    }
    function rotate(out, a, rad, axis) {
      var x = axis[0], y = axis[1], z = axis[2];
      var len = Math.hypot(x, y, z);
      var s, c, t;
      var a00, a01, a02, a03;
      var a10, a11, a12, a13;
      var a20, a21, a22, a23;
      var b00, b01, b02;
      var b10, b11, b12;
      var b20, b21, b22;
      if (len < glMatrix.EPSILON) {
        return null;
      }
      len = 1 / len;
      x *= len;
      y *= len;
      z *= len;
      s = Math.sin(rad);
      c = Math.cos(rad);
      t = 1 - c;
      a00 = a[0];
      a01 = a[1];
      a02 = a[2];
      a03 = a[3];
      a10 = a[4];
      a11 = a[5];
      a12 = a[6];
      a13 = a[7];
      a20 = a[8];
      a21 = a[9];
      a22 = a[10];
      a23 = a[11];
      b00 = x * x * t + c;
      b01 = y * x * t + z * s;
      b02 = z * x * t - y * s;
      b10 = x * y * t - z * s;
      b11 = y * y * t + c;
      b12 = z * y * t + x * s;
      b20 = x * z * t + y * s;
      b21 = y * z * t - x * s;
      b22 = z * z * t + c;
      out[0] = a00 * b00 + a10 * b01 + a20 * b02;
      out[1] = a01 * b00 + a11 * b01 + a21 * b02;
      out[2] = a02 * b00 + a12 * b01 + a22 * b02;
      out[3] = a03 * b00 + a13 * b01 + a23 * b02;
      out[4] = a00 * b10 + a10 * b11 + a20 * b12;
      out[5] = a01 * b10 + a11 * b11 + a21 * b12;
      out[6] = a02 * b10 + a12 * b11 + a22 * b12;
      out[7] = a03 * b10 + a13 * b11 + a23 * b12;
      out[8] = a00 * b20 + a10 * b21 + a20 * b22;
      out[9] = a01 * b20 + a11 * b21 + a21 * b22;
      out[10] = a02 * b20 + a12 * b21 + a22 * b22;
      out[11] = a03 * b20 + a13 * b21 + a23 * b22;
      if (a !== out) {
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      return out;
    }
    function rotateX(out, a, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      var a10 = a[4];
      var a11 = a[5];
      var a12 = a[6];
      var a13 = a[7];
      var a20 = a[8];
      var a21 = a[9];
      var a22 = a[10];
      var a23 = a[11];
      if (a !== out) {
        out[0] = a[0];
        out[1] = a[1];
        out[2] = a[2];
        out[3] = a[3];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      out[4] = a10 * c + a20 * s;
      out[5] = a11 * c + a21 * s;
      out[6] = a12 * c + a22 * s;
      out[7] = a13 * c + a23 * s;
      out[8] = a20 * c - a10 * s;
      out[9] = a21 * c - a11 * s;
      out[10] = a22 * c - a12 * s;
      out[11] = a23 * c - a13 * s;
      return out;
    }
    function rotateY(out, a, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      var a00 = a[0];
      var a01 = a[1];
      var a02 = a[2];
      var a03 = a[3];
      var a20 = a[8];
      var a21 = a[9];
      var a22 = a[10];
      var a23 = a[11];
      if (a !== out) {
        out[4] = a[4];
        out[5] = a[5];
        out[6] = a[6];
        out[7] = a[7];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      out[0] = a00 * c - a20 * s;
      out[1] = a01 * c - a21 * s;
      out[2] = a02 * c - a22 * s;
      out[3] = a03 * c - a23 * s;
      out[8] = a00 * s + a20 * c;
      out[9] = a01 * s + a21 * c;
      out[10] = a02 * s + a22 * c;
      out[11] = a03 * s + a23 * c;
      return out;
    }
    function rotateZ(out, a, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      var a00 = a[0];
      var a01 = a[1];
      var a02 = a[2];
      var a03 = a[3];
      var a10 = a[4];
      var a11 = a[5];
      var a12 = a[6];
      var a13 = a[7];
      if (a !== out) {
        out[8] = a[8];
        out[9] = a[9];
        out[10] = a[10];
        out[11] = a[11];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      out[0] = a00 * c + a10 * s;
      out[1] = a01 * c + a11 * s;
      out[2] = a02 * c + a12 * s;
      out[3] = a03 * c + a13 * s;
      out[4] = a10 * c - a00 * s;
      out[5] = a11 * c - a01 * s;
      out[6] = a12 * c - a02 * s;
      out[7] = a13 * c - a03 * s;
      return out;
    }
    function fromTranslation(out, v) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = 1;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = 1;
      out[11] = 0;
      out[12] = v[0];
      out[13] = v[1];
      out[14] = v[2];
      out[15] = 1;
      return out;
    }
    function fromScaling(out, v) {
      out[0] = v[0];
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = v[1];
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = v[2];
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function fromRotation(out, rad, axis) {
      var x = axis[0], y = axis[1], z = axis[2];
      var len = Math.hypot(x, y, z);
      var s, c, t;
      if (len < glMatrix.EPSILON) {
        return null;
      }
      len = 1 / len;
      x *= len;
      y *= len;
      z *= len;
      s = Math.sin(rad);
      c = Math.cos(rad);
      t = 1 - c;
      out[0] = x * x * t + c;
      out[1] = y * x * t + z * s;
      out[2] = z * x * t - y * s;
      out[3] = 0;
      out[4] = x * y * t - z * s;
      out[5] = y * y * t + c;
      out[6] = z * y * t + x * s;
      out[7] = 0;
      out[8] = x * z * t + y * s;
      out[9] = y * z * t - x * s;
      out[10] = z * z * t + c;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function fromXRotation(out, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = c;
      out[6] = s;
      out[7] = 0;
      out[8] = 0;
      out[9] = -s;
      out[10] = c;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function fromYRotation(out, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = c;
      out[1] = 0;
      out[2] = -s;
      out[3] = 0;
      out[4] = 0;
      out[5] = 1;
      out[6] = 0;
      out[7] = 0;
      out[8] = s;
      out[9] = 0;
      out[10] = c;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function fromZRotation(out, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = c;
      out[1] = s;
      out[2] = 0;
      out[3] = 0;
      out[4] = -s;
      out[5] = c;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = 1;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function fromRotationTranslation(out, q, v) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x;
      var y2 = y + y;
      var z2 = z + z;
      var xx = x * x2;
      var xy = x * y2;
      var xz = x * z2;
      var yy = y * y2;
      var yz = y * z2;
      var zz = z * z2;
      var wx = w * x2;
      var wy = w * y2;
      var wz = w * z2;
      out[0] = 1 - (yy + zz);
      out[1] = xy + wz;
      out[2] = xz - wy;
      out[3] = 0;
      out[4] = xy - wz;
      out[5] = 1 - (xx + zz);
      out[6] = yz + wx;
      out[7] = 0;
      out[8] = xz + wy;
      out[9] = yz - wx;
      out[10] = 1 - (xx + yy);
      out[11] = 0;
      out[12] = v[0];
      out[13] = v[1];
      out[14] = v[2];
      out[15] = 1;
      return out;
    }
    function fromQuat2(out, a) {
      var translation = new glMatrix.ARRAY_TYPE(3);
      var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7];
      var magnitude = bx * bx + by * by + bz * bz + bw * bw;
      if (magnitude > 0) {
        translation[0] = (ax * bw + aw * bx + ay * bz - az * by) * 2 / magnitude;
        translation[1] = (ay * bw + aw * by + az * bx - ax * bz) * 2 / magnitude;
        translation[2] = (az * bw + aw * bz + ax * by - ay * bx) * 2 / magnitude;
      } else {
        translation[0] = (ax * bw + aw * bx + ay * bz - az * by) * 2;
        translation[1] = (ay * bw + aw * by + az * bx - ax * bz) * 2;
        translation[2] = (az * bw + aw * bz + ax * by - ay * bx) * 2;
      }
      fromRotationTranslation(out, a, translation);
      return out;
    }
    function getTranslation(out, mat) {
      out[0] = mat[12];
      out[1] = mat[13];
      out[2] = mat[14];
      return out;
    }
    function getScaling(out, mat) {
      var m11 = mat[0];
      var m12 = mat[1];
      var m13 = mat[2];
      var m21 = mat[4];
      var m22 = mat[5];
      var m23 = mat[6];
      var m31 = mat[8];
      var m32 = mat[9];
      var m33 = mat[10];
      out[0] = Math.hypot(m11, m12, m13);
      out[1] = Math.hypot(m21, m22, m23);
      out[2] = Math.hypot(m31, m32, m33);
      return out;
    }
    function getRotation(out, mat) {
      var scaling = new glMatrix.ARRAY_TYPE(3);
      getScaling(scaling, mat);
      var is1 = 1 / scaling[0];
      var is2 = 1 / scaling[1];
      var is3 = 1 / scaling[2];
      var sm11 = mat[0] * is1;
      var sm12 = mat[1] * is2;
      var sm13 = mat[2] * is3;
      var sm21 = mat[4] * is1;
      var sm22 = mat[5] * is2;
      var sm23 = mat[6] * is3;
      var sm31 = mat[8] * is1;
      var sm32 = mat[9] * is2;
      var sm33 = mat[10] * is3;
      var trace = sm11 + sm22 + sm33;
      var S = 0;
      if (trace > 0) {
        S = Math.sqrt(trace + 1) * 2;
        out[3] = 0.25 * S;
        out[0] = (sm23 - sm32) / S;
        out[1] = (sm31 - sm13) / S;
        out[2] = (sm12 - sm21) / S;
      } else if (sm11 > sm22 && sm11 > sm33) {
        S = Math.sqrt(1 + sm11 - sm22 - sm33) * 2;
        out[3] = (sm23 - sm32) / S;
        out[0] = 0.25 * S;
        out[1] = (sm12 + sm21) / S;
        out[2] = (sm31 + sm13) / S;
      } else if (sm22 > sm33) {
        S = Math.sqrt(1 + sm22 - sm11 - sm33) * 2;
        out[3] = (sm31 - sm13) / S;
        out[0] = (sm12 + sm21) / S;
        out[1] = 0.25 * S;
        out[2] = (sm23 + sm32) / S;
      } else {
        S = Math.sqrt(1 + sm33 - sm11 - sm22) * 2;
        out[3] = (sm12 - sm21) / S;
        out[0] = (sm31 + sm13) / S;
        out[1] = (sm23 + sm32) / S;
        out[2] = 0.25 * S;
      }
      return out;
    }
    function fromRotationTranslationScale(out, q, v, s) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x;
      var y2 = y + y;
      var z2 = z + z;
      var xx = x * x2;
      var xy = x * y2;
      var xz = x * z2;
      var yy = y * y2;
      var yz = y * z2;
      var zz = z * z2;
      var wx = w * x2;
      var wy = w * y2;
      var wz = w * z2;
      var sx = s[0];
      var sy = s[1];
      var sz = s[2];
      out[0] = (1 - (yy + zz)) * sx;
      out[1] = (xy + wz) * sx;
      out[2] = (xz - wy) * sx;
      out[3] = 0;
      out[4] = (xy - wz) * sy;
      out[5] = (1 - (xx + zz)) * sy;
      out[6] = (yz + wx) * sy;
      out[7] = 0;
      out[8] = (xz + wy) * sz;
      out[9] = (yz - wx) * sz;
      out[10] = (1 - (xx + yy)) * sz;
      out[11] = 0;
      out[12] = v[0];
      out[13] = v[1];
      out[14] = v[2];
      out[15] = 1;
      return out;
    }
    function fromRotationTranslationScaleOrigin(out, q, v, s, o) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x;
      var y2 = y + y;
      var z2 = z + z;
      var xx = x * x2;
      var xy = x * y2;
      var xz = x * z2;
      var yy = y * y2;
      var yz = y * z2;
      var zz = z * z2;
      var wx = w * x2;
      var wy = w * y2;
      var wz = w * z2;
      var sx = s[0];
      var sy = s[1];
      var sz = s[2];
      var ox = o[0];
      var oy = o[1];
      var oz = o[2];
      var out0 = (1 - (yy + zz)) * sx;
      var out1 = (xy + wz) * sx;
      var out2 = (xz - wy) * sx;
      var out4 = (xy - wz) * sy;
      var out5 = (1 - (xx + zz)) * sy;
      var out6 = (yz + wx) * sy;
      var out8 = (xz + wy) * sz;
      var out9 = (yz - wx) * sz;
      var out10 = (1 - (xx + yy)) * sz;
      out[0] = out0;
      out[1] = out1;
      out[2] = out2;
      out[3] = 0;
      out[4] = out4;
      out[5] = out5;
      out[6] = out6;
      out[7] = 0;
      out[8] = out8;
      out[9] = out9;
      out[10] = out10;
      out[11] = 0;
      out[12] = v[0] + ox - (out0 * ox + out4 * oy + out8 * oz);
      out[13] = v[1] + oy - (out1 * ox + out5 * oy + out9 * oz);
      out[14] = v[2] + oz - (out2 * ox + out6 * oy + out10 * oz);
      out[15] = 1;
      return out;
    }
    function fromQuat(out, q) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x;
      var y2 = y + y;
      var z2 = z + z;
      var xx = x * x2;
      var yx = y * x2;
      var yy = y * y2;
      var zx = z * x2;
      var zy = z * y2;
      var zz = z * z2;
      var wx = w * x2;
      var wy = w * y2;
      var wz = w * z2;
      out[0] = 1 - yy - zz;
      out[1] = yx + wz;
      out[2] = zx - wy;
      out[3] = 0;
      out[4] = yx - wz;
      out[5] = 1 - xx - zz;
      out[6] = zy + wx;
      out[7] = 0;
      out[8] = zx + wy;
      out[9] = zy - wx;
      out[10] = 1 - xx - yy;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function frustum(out, left, right, bottom, top, near, far) {
      var rl = 1 / (right - left);
      var tb = 1 / (top - bottom);
      var nf = 1 / (near - far);
      out[0] = near * 2 * rl;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = near * 2 * tb;
      out[6] = 0;
      out[7] = 0;
      out[8] = (right + left) * rl;
      out[9] = (top + bottom) * tb;
      out[10] = (far + near) * nf;
      out[11] = -1;
      out[12] = 0;
      out[13] = 0;
      out[14] = far * near * 2 * nf;
      out[15] = 0;
      return out;
    }
    function perspectiveNO(out, fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2), nf;
      out[0] = f / aspect;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = f;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[11] = -1;
      out[12] = 0;
      out[13] = 0;
      out[15] = 0;
      if (far != null && far !== Infinity) {
        nf = 1 / (near - far);
        out[10] = (far + near) * nf;
        out[14] = 2 * far * near * nf;
      } else {
        out[10] = -1;
        out[14] = -2 * near;
      }
      return out;
    }
    var perspective = perspectiveNO;
    exports.perspective = perspective;
    function perspectiveZO(out, fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2), nf;
      out[0] = f / aspect;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = f;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[11] = -1;
      out[12] = 0;
      out[13] = 0;
      out[15] = 0;
      if (far != null && far !== Infinity) {
        nf = 1 / (near - far);
        out[10] = far * nf;
        out[14] = far * near * nf;
      } else {
        out[10] = -1;
        out[14] = -near;
      }
      return out;
    }
    function perspectiveFromFieldOfView(out, fov, near, far) {
      var upTan = Math.tan(fov.upDegrees * Math.PI / 180);
      var downTan = Math.tan(fov.downDegrees * Math.PI / 180);
      var leftTan = Math.tan(fov.leftDegrees * Math.PI / 180);
      var rightTan = Math.tan(fov.rightDegrees * Math.PI / 180);
      var xScale = 2 / (leftTan + rightTan);
      var yScale = 2 / (upTan + downTan);
      out[0] = xScale;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = yScale;
      out[6] = 0;
      out[7] = 0;
      out[8] = -((leftTan - rightTan) * xScale * 0.5);
      out[9] = (upTan - downTan) * yScale * 0.5;
      out[10] = far / (near - far);
      out[11] = -1;
      out[12] = 0;
      out[13] = 0;
      out[14] = far * near / (near - far);
      out[15] = 0;
      return out;
    }
    function orthoNO(out, left, right, bottom, top, near, far) {
      var lr = 1 / (left - right);
      var bt = 1 / (bottom - top);
      var nf = 1 / (near - far);
      out[0] = -2 * lr;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = -2 * bt;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = 2 * nf;
      out[11] = 0;
      out[12] = (left + right) * lr;
      out[13] = (top + bottom) * bt;
      out[14] = (far + near) * nf;
      out[15] = 1;
      return out;
    }
    var ortho = orthoNO;
    exports.ortho = ortho;
    function orthoZO(out, left, right, bottom, top, near, far) {
      var lr = 1 / (left - right);
      var bt = 1 / (bottom - top);
      var nf = 1 / (near - far);
      out[0] = -2 * lr;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = -2 * bt;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = nf;
      out[11] = 0;
      out[12] = (left + right) * lr;
      out[13] = (top + bottom) * bt;
      out[14] = near * nf;
      out[15] = 1;
      return out;
    }
    function lookAt(out, eye, center, up) {
      var x0, x1, x2, y0, y1, y2, z0, z1, z2, len;
      var eyex = eye[0];
      var eyey = eye[1];
      var eyez = eye[2];
      var upx = up[0];
      var upy = up[1];
      var upz = up[2];
      var centerx = center[0];
      var centery = center[1];
      var centerz = center[2];
      if (Math.abs(eyex - centerx) < glMatrix.EPSILON && Math.abs(eyey - centery) < glMatrix.EPSILON && Math.abs(eyez - centerz) < glMatrix.EPSILON) {
        return identity(out);
      }
      z0 = eyex - centerx;
      z1 = eyey - centery;
      z2 = eyez - centerz;
      len = 1 / Math.hypot(z0, z1, z2);
      z0 *= len;
      z1 *= len;
      z2 *= len;
      x0 = upy * z2 - upz * z1;
      x1 = upz * z0 - upx * z2;
      x2 = upx * z1 - upy * z0;
      len = Math.hypot(x0, x1, x2);
      if (!len) {
        x0 = 0;
        x1 = 0;
        x2 = 0;
      } else {
        len = 1 / len;
        x0 *= len;
        x1 *= len;
        x2 *= len;
      }
      y0 = z1 * x2 - z2 * x1;
      y1 = z2 * x0 - z0 * x2;
      y2 = z0 * x1 - z1 * x0;
      len = Math.hypot(y0, y1, y2);
      if (!len) {
        y0 = 0;
        y1 = 0;
        y2 = 0;
      } else {
        len = 1 / len;
        y0 *= len;
        y1 *= len;
        y2 *= len;
      }
      out[0] = x0;
      out[1] = y0;
      out[2] = z0;
      out[3] = 0;
      out[4] = x1;
      out[5] = y1;
      out[6] = z1;
      out[7] = 0;
      out[8] = x2;
      out[9] = y2;
      out[10] = z2;
      out[11] = 0;
      out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
      out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
      out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
      out[15] = 1;
      return out;
    }
    function targetTo(out, eye, target, up) {
      var eyex = eye[0], eyey = eye[1], eyez = eye[2], upx = up[0], upy = up[1], upz = up[2];
      var z0 = eyex - target[0], z1 = eyey - target[1], z2 = eyez - target[2];
      var len = z0 * z0 + z1 * z1 + z2 * z2;
      if (len > 0) {
        len = 1 / Math.sqrt(len);
        z0 *= len;
        z1 *= len;
        z2 *= len;
      }
      var x0 = upy * z2 - upz * z1, x1 = upz * z0 - upx * z2, x2 = upx * z1 - upy * z0;
      len = x0 * x0 + x1 * x1 + x2 * x2;
      if (len > 0) {
        len = 1 / Math.sqrt(len);
        x0 *= len;
        x1 *= len;
        x2 *= len;
      }
      out[0] = x0;
      out[1] = x1;
      out[2] = x2;
      out[3] = 0;
      out[4] = z1 * x2 - z2 * x1;
      out[5] = z2 * x0 - z0 * x2;
      out[6] = z0 * x1 - z1 * x0;
      out[7] = 0;
      out[8] = z0;
      out[9] = z1;
      out[10] = z2;
      out[11] = 0;
      out[12] = eyex;
      out[13] = eyey;
      out[14] = eyez;
      out[15] = 1;
      return out;
    }
    function str(a) {
      return "mat4(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ", " + a[6] + ", " + a[7] + ", " + a[8] + ", " + a[9] + ", " + a[10] + ", " + a[11] + ", " + a[12] + ", " + a[13] + ", " + a[14] + ", " + a[15] + ")";
    }
    function frob(a) {
      return Math.hypot(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12], a[13], a[14], a[15]);
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      out[4] = a[4] + b[4];
      out[5] = a[5] + b[5];
      out[6] = a[6] + b[6];
      out[7] = a[7] + b[7];
      out[8] = a[8] + b[8];
      out[9] = a[9] + b[9];
      out[10] = a[10] + b[10];
      out[11] = a[11] + b[11];
      out[12] = a[12] + b[12];
      out[13] = a[13] + b[13];
      out[14] = a[14] + b[14];
      out[15] = a[15] + b[15];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      out[3] = a[3] - b[3];
      out[4] = a[4] - b[4];
      out[5] = a[5] - b[5];
      out[6] = a[6] - b[6];
      out[7] = a[7] - b[7];
      out[8] = a[8] - b[8];
      out[9] = a[9] - b[9];
      out[10] = a[10] - b[10];
      out[11] = a[11] - b[11];
      out[12] = a[12] - b[12];
      out[13] = a[13] - b[13];
      out[14] = a[14] - b[14];
      out[15] = a[15] - b[15];
      return out;
    }
    function multiplyScalar(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      out[4] = a[4] * b;
      out[5] = a[5] * b;
      out[6] = a[6] * b;
      out[7] = a[7] * b;
      out[8] = a[8] * b;
      out[9] = a[9] * b;
      out[10] = a[10] * b;
      out[11] = a[11] * b;
      out[12] = a[12] * b;
      out[13] = a[13] * b;
      out[14] = a[14] * b;
      out[15] = a[15] * b;
      return out;
    }
    function multiplyScalarAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      out[3] = a[3] + b[3] * scale2;
      out[4] = a[4] + b[4] * scale2;
      out[5] = a[5] + b[5] * scale2;
      out[6] = a[6] + b[6] * scale2;
      out[7] = a[7] + b[7] * scale2;
      out[8] = a[8] + b[8] * scale2;
      out[9] = a[9] + b[9] * scale2;
      out[10] = a[10] + b[10] * scale2;
      out[11] = a[11] + b[11] * scale2;
      out[12] = a[12] + b[12] * scale2;
      out[13] = a[13] + b[13] * scale2;
      out[14] = a[14] + b[14] * scale2;
      out[15] = a[15] + b[15] * scale2;
      return out;
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7] && a[8] === b[8] && a[9] === b[9] && a[10] === b[10] && a[11] === b[11] && a[12] === b[12] && a[13] === b[13] && a[14] === b[14] && a[15] === b[15];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
      var a8 = a[8], a9 = a[9], a10 = a[10], a11 = a[11];
      var a12 = a[12], a13 = a[13], a14 = a[14], a15 = a[15];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      var b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
      var b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11];
      var b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= glMatrix.EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= glMatrix.EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5)) && Math.abs(a6 - b6) <= glMatrix.EPSILON * Math.max(1, Math.abs(a6), Math.abs(b6)) && Math.abs(a7 - b7) <= glMatrix.EPSILON * Math.max(1, Math.abs(a7), Math.abs(b7)) && Math.abs(a8 - b8) <= glMatrix.EPSILON * Math.max(1, Math.abs(a8), Math.abs(b8)) && Math.abs(a9 - b9) <= glMatrix.EPSILON * Math.max(1, Math.abs(a9), Math.abs(b9)) && Math.abs(a10 - b10) <= glMatrix.EPSILON * Math.max(1, Math.abs(a10), Math.abs(b10)) && Math.abs(a11 - b11) <= glMatrix.EPSILON * Math.max(1, Math.abs(a11), Math.abs(b11)) && Math.abs(a12 - b12) <= glMatrix.EPSILON * Math.max(1, Math.abs(a12), Math.abs(b12)) && Math.abs(a13 - b13) <= glMatrix.EPSILON * Math.max(1, Math.abs(a13), Math.abs(b13)) && Math.abs(a14 - b14) <= glMatrix.EPSILON * Math.max(1, Math.abs(a14), Math.abs(b14)) && Math.abs(a15 - b15) <= glMatrix.EPSILON * Math.max(1, Math.abs(a15), Math.abs(b15));
    }
    var mul = multiply;
    exports.mul = mul;
    var sub = subtract;
    exports.sub = sub;
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/vec3.js
var require_vec3 = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/vec3.js"(exports) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof = function _typeof2(obj2) {
          return typeof obj2;
        };
      } else {
        _typeof = function _typeof2(obj2) {
          return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
        };
      }
      return _typeof(obj);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.create = create;
    exports.clone = clone;
    exports.length = length;
    exports.fromValues = fromValues;
    exports.copy = copy;
    exports.set = set;
    exports.add = add;
    exports.subtract = subtract;
    exports.multiply = multiply;
    exports.divide = divide;
    exports.ceil = ceil;
    exports.floor = floor;
    exports.min = min;
    exports.max = max;
    exports.round = round;
    exports.scale = scale;
    exports.scaleAndAdd = scaleAndAdd;
    exports.distance = distance;
    exports.squaredDistance = squaredDistance;
    exports.squaredLength = squaredLength;
    exports.negate = negate;
    exports.inverse = inverse;
    exports.normalize = normalize;
    exports.dot = dot;
    exports.cross = cross;
    exports.lerp = lerp;
    exports.hermite = hermite;
    exports.bezier = bezier;
    exports.random = random;
    exports.transformMat4 = transformMat4;
    exports.transformMat3 = transformMat3;
    exports.transformQuat = transformQuat;
    exports.rotateX = rotateX;
    exports.rotateY = rotateY;
    exports.rotateZ = rotateZ;
    exports.angle = angle;
    exports.zero = zero;
    exports.str = str;
    exports.exactEquals = exactEquals;
    exports.equals = equals;
    exports.forEach = exports.sqrLen = exports.len = exports.sqrDist = exports.dist = exports.div = exports.mul = exports.sub = void 0;
    var glMatrix = _interopRequireWildcard(require_common());
    function _getRequireWildcardCache(nodeInterop) {
      if (typeof WeakMap !== "function") return null;
      var cacheBabelInterop = /* @__PURE__ */ new WeakMap();
      var cacheNodeInterop = /* @__PURE__ */ new WeakMap();
      return (_getRequireWildcardCache = function _getRequireWildcardCache2(nodeInterop2) {
        return nodeInterop2 ? cacheNodeInterop : cacheBabelInterop;
      })(nodeInterop);
    }
    function _interopRequireWildcard(obj, nodeInterop) {
      if (!nodeInterop && obj && obj.__esModule) {
        return obj;
      }
      if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") {
        return { "default": obj };
      }
      var cache = _getRequireWildcardCache(nodeInterop);
      if (cache && cache.has(obj)) {
        return cache.get(obj);
      }
      var newObj = {};
      var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var key in obj) {
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
          var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
          if (desc && (desc.get || desc.set)) {
            Object.defineProperty(newObj, key, desc);
          } else {
            newObj[key] = obj[key];
          }
        }
      }
      newObj["default"] = obj;
      if (cache) {
        cache.set(obj, newObj);
      }
      return newObj;
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(3);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
      }
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(3);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      return out;
    }
    function length(a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      return Math.hypot(x, y, z);
    }
    function fromValues(x, y, z) {
      var out = new glMatrix.ARRAY_TYPE(3);
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      return out;
    }
    function set(out, x, y, z) {
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return out;
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      return out;
    }
    function multiply(out, a, b) {
      out[0] = a[0] * b[0];
      out[1] = a[1] * b[1];
      out[2] = a[2] * b[2];
      return out;
    }
    function divide(out, a, b) {
      out[0] = a[0] / b[0];
      out[1] = a[1] / b[1];
      out[2] = a[2] / b[2];
      return out;
    }
    function ceil(out, a) {
      out[0] = Math.ceil(a[0]);
      out[1] = Math.ceil(a[1]);
      out[2] = Math.ceil(a[2]);
      return out;
    }
    function floor(out, a) {
      out[0] = Math.floor(a[0]);
      out[1] = Math.floor(a[1]);
      out[2] = Math.floor(a[2]);
      return out;
    }
    function min(out, a, b) {
      out[0] = Math.min(a[0], b[0]);
      out[1] = Math.min(a[1], b[1]);
      out[2] = Math.min(a[2], b[2]);
      return out;
    }
    function max(out, a, b) {
      out[0] = Math.max(a[0], b[0]);
      out[1] = Math.max(a[1], b[1]);
      out[2] = Math.max(a[2], b[2]);
      return out;
    }
    function round(out, a) {
      out[0] = Math.round(a[0]);
      out[1] = Math.round(a[1]);
      out[2] = Math.round(a[2]);
      return out;
    }
    function scale(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      return out;
    }
    function scaleAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      return out;
    }
    function distance(a, b) {
      var x = b[0] - a[0];
      var y = b[1] - a[1];
      var z = b[2] - a[2];
      return Math.hypot(x, y, z);
    }
    function squaredDistance(a, b) {
      var x = b[0] - a[0];
      var y = b[1] - a[1];
      var z = b[2] - a[2];
      return x * x + y * y + z * z;
    }
    function squaredLength(a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      return x * x + y * y + z * z;
    }
    function negate(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      out[2] = -a[2];
      return out;
    }
    function inverse(out, a) {
      out[0] = 1 / a[0];
      out[1] = 1 / a[1];
      out[2] = 1 / a[2];
      return out;
    }
    function normalize(out, a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      var len2 = x * x + y * y + z * z;
      if (len2 > 0) {
        len2 = 1 / Math.sqrt(len2);
      }
      out[0] = a[0] * len2;
      out[1] = a[1] * len2;
      out[2] = a[2] * len2;
      return out;
    }
    function dot(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }
    function cross(out, a, b) {
      var ax = a[0], ay = a[1], az = a[2];
      var bx = b[0], by = b[1], bz = b[2];
      out[0] = ay * bz - az * by;
      out[1] = az * bx - ax * bz;
      out[2] = ax * by - ay * bx;
      return out;
    }
    function lerp(out, a, b, t) {
      var ax = a[0];
      var ay = a[1];
      var az = a[2];
      out[0] = ax + t * (b[0] - ax);
      out[1] = ay + t * (b[1] - ay);
      out[2] = az + t * (b[2] - az);
      return out;
    }
    function hermite(out, a, b, c, d, t) {
      var factorTimes2 = t * t;
      var factor1 = factorTimes2 * (2 * t - 3) + 1;
      var factor2 = factorTimes2 * (t - 2) + t;
      var factor3 = factorTimes2 * (t - 1);
      var factor4 = factorTimes2 * (3 - 2 * t);
      out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;
      out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;
      out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;
      return out;
    }
    function bezier(out, a, b, c, d, t) {
      var inverseFactor = 1 - t;
      var inverseFactorTimesTwo = inverseFactor * inverseFactor;
      var factorTimes2 = t * t;
      var factor1 = inverseFactorTimesTwo * inverseFactor;
      var factor2 = 3 * t * inverseFactorTimesTwo;
      var factor3 = 3 * factorTimes2 * inverseFactor;
      var factor4 = factorTimes2 * t;
      out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;
      out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;
      out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;
      return out;
    }
    function random(out, scale2) {
      scale2 = scale2 || 1;
      var r = glMatrix.RANDOM() * 2 * Math.PI;
      var z = glMatrix.RANDOM() * 2 - 1;
      var zScale = Math.sqrt(1 - z * z) * scale2;
      out[0] = Math.cos(r) * zScale;
      out[1] = Math.sin(r) * zScale;
      out[2] = z * scale2;
      return out;
    }
    function transformMat4(out, a, m) {
      var x = a[0], y = a[1], z = a[2];
      var w = m[3] * x + m[7] * y + m[11] * z + m[15];
      w = w || 1;
      out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      return out;
    }
    function transformMat3(out, a, m) {
      var x = a[0], y = a[1], z = a[2];
      out[0] = x * m[0] + y * m[3] + z * m[6];
      out[1] = x * m[1] + y * m[4] + z * m[7];
      out[2] = x * m[2] + y * m[5] + z * m[8];
      return out;
    }
    function transformQuat(out, a, q) {
      var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      var x = a[0], y = a[1], z = a[2];
      var uvx = qy * z - qz * y, uvy = qz * x - qx * z, uvz = qx * y - qy * x;
      var uuvx = qy * uvz - qz * uvy, uuvy = qz * uvx - qx * uvz, uuvz = qx * uvy - qy * uvx;
      var w2 = qw * 2;
      uvx *= w2;
      uvy *= w2;
      uvz *= w2;
      uuvx *= 2;
      uuvy *= 2;
      uuvz *= 2;
      out[0] = x + uvx + uuvx;
      out[1] = y + uvy + uuvy;
      out[2] = z + uvz + uuvz;
      return out;
    }
    function rotateX(out, a, b, rad) {
      var p = [], r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[0];
      r[1] = p[1] * Math.cos(rad) - p[2] * Math.sin(rad);
      r[2] = p[1] * Math.sin(rad) + p[2] * Math.cos(rad);
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    }
    function rotateY(out, a, b, rad) {
      var p = [], r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[2] * Math.sin(rad) + p[0] * Math.cos(rad);
      r[1] = p[1];
      r[2] = p[2] * Math.cos(rad) - p[0] * Math.sin(rad);
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    }
    function rotateZ(out, a, b, rad) {
      var p = [], r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[0] * Math.cos(rad) - p[1] * Math.sin(rad);
      r[1] = p[0] * Math.sin(rad) + p[1] * Math.cos(rad);
      r[2] = p[2];
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    }
    function angle(a, b) {
      var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2], mag1 = Math.sqrt(ax * ax + ay * ay + az * az), mag2 = Math.sqrt(bx * bx + by * by + bz * bz), mag = mag1 * mag2, cosine = mag && dot(a, b) / mag;
      return Math.acos(Math.min(Math.max(cosine, -1), 1));
    }
    function zero(out) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      return out;
    }
    function str(a) {
      return "vec3(" + a[0] + ", " + a[1] + ", " + a[2] + ")";
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2];
      var b0 = b[0], b1 = b[1], b2 = b[2];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2));
    }
    var sub = subtract;
    exports.sub = sub;
    var mul = multiply;
    exports.mul = mul;
    var div = divide;
    exports.div = div;
    var dist = distance;
    exports.dist = dist;
    var sqrDist = squaredDistance;
    exports.sqrDist = sqrDist;
    var len = length;
    exports.len = len;
    var sqrLen = squaredLength;
    exports.sqrLen = sqrLen;
    var forEach = (function() {
      var vec = create();
      return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if (!stride) {
          stride = 3;
        }
        if (!offset) {
          offset = 0;
        }
        if (count) {
          l = Math.min(count * stride + offset, a.length);
        } else {
          l = a.length;
        }
        for (i = offset; i < l; i += stride) {
          vec[0] = a[i];
          vec[1] = a[i + 1];
          vec[2] = a[i + 2];
          fn(vec, vec, arg);
          a[i] = vec[0];
          a[i + 1] = vec[1];
          a[i + 2] = vec[2];
        }
        return a;
      };
    })();
    exports.forEach = forEach;
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/vec4.js
var require_vec4 = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/vec4.js"(exports) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof = function _typeof2(obj2) {
          return typeof obj2;
        };
      } else {
        _typeof = function _typeof2(obj2) {
          return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
        };
      }
      return _typeof(obj);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.create = create;
    exports.clone = clone;
    exports.fromValues = fromValues;
    exports.copy = copy;
    exports.set = set;
    exports.add = add;
    exports.subtract = subtract;
    exports.multiply = multiply;
    exports.divide = divide;
    exports.ceil = ceil;
    exports.floor = floor;
    exports.min = min;
    exports.max = max;
    exports.round = round;
    exports.scale = scale;
    exports.scaleAndAdd = scaleAndAdd;
    exports.distance = distance;
    exports.squaredDistance = squaredDistance;
    exports.length = length;
    exports.squaredLength = squaredLength;
    exports.negate = negate;
    exports.inverse = inverse;
    exports.normalize = normalize;
    exports.dot = dot;
    exports.cross = cross;
    exports.lerp = lerp;
    exports.random = random;
    exports.transformMat4 = transformMat4;
    exports.transformQuat = transformQuat;
    exports.zero = zero;
    exports.str = str;
    exports.exactEquals = exactEquals;
    exports.equals = equals;
    exports.forEach = exports.sqrLen = exports.len = exports.sqrDist = exports.dist = exports.div = exports.mul = exports.sub = void 0;
    var glMatrix = _interopRequireWildcard(require_common());
    function _getRequireWildcardCache(nodeInterop) {
      if (typeof WeakMap !== "function") return null;
      var cacheBabelInterop = /* @__PURE__ */ new WeakMap();
      var cacheNodeInterop = /* @__PURE__ */ new WeakMap();
      return (_getRequireWildcardCache = function _getRequireWildcardCache2(nodeInterop2) {
        return nodeInterop2 ? cacheNodeInterop : cacheBabelInterop;
      })(nodeInterop);
    }
    function _interopRequireWildcard(obj, nodeInterop) {
      if (!nodeInterop && obj && obj.__esModule) {
        return obj;
      }
      if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") {
        return { "default": obj };
      }
      var cache = _getRequireWildcardCache(nodeInterop);
      if (cache && cache.has(obj)) {
        return cache.get(obj);
      }
      var newObj = {};
      var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var key in obj) {
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
          var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
          if (desc && (desc.get || desc.set)) {
            Object.defineProperty(newObj, key, desc);
          } else {
            newObj[key] = obj[key];
          }
        }
      }
      newObj["default"] = obj;
      if (cache) {
        cache.set(obj, newObj);
      }
      return newObj;
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(4);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
      }
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(4);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    }
    function fromValues(x, y, z, w) {
      var out = new glMatrix.ARRAY_TYPE(4);
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[3] = w;
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    }
    function set(out, x, y, z, w) {
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[3] = w;
      return out;
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      out[3] = a[3] - b[3];
      return out;
    }
    function multiply(out, a, b) {
      out[0] = a[0] * b[0];
      out[1] = a[1] * b[1];
      out[2] = a[2] * b[2];
      out[3] = a[3] * b[3];
      return out;
    }
    function divide(out, a, b) {
      out[0] = a[0] / b[0];
      out[1] = a[1] / b[1];
      out[2] = a[2] / b[2];
      out[3] = a[3] / b[3];
      return out;
    }
    function ceil(out, a) {
      out[0] = Math.ceil(a[0]);
      out[1] = Math.ceil(a[1]);
      out[2] = Math.ceil(a[2]);
      out[3] = Math.ceil(a[3]);
      return out;
    }
    function floor(out, a) {
      out[0] = Math.floor(a[0]);
      out[1] = Math.floor(a[1]);
      out[2] = Math.floor(a[2]);
      out[3] = Math.floor(a[3]);
      return out;
    }
    function min(out, a, b) {
      out[0] = Math.min(a[0], b[0]);
      out[1] = Math.min(a[1], b[1]);
      out[2] = Math.min(a[2], b[2]);
      out[3] = Math.min(a[3], b[3]);
      return out;
    }
    function max(out, a, b) {
      out[0] = Math.max(a[0], b[0]);
      out[1] = Math.max(a[1], b[1]);
      out[2] = Math.max(a[2], b[2]);
      out[3] = Math.max(a[3], b[3]);
      return out;
    }
    function round(out, a) {
      out[0] = Math.round(a[0]);
      out[1] = Math.round(a[1]);
      out[2] = Math.round(a[2]);
      out[3] = Math.round(a[3]);
      return out;
    }
    function scale(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      return out;
    }
    function scaleAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      out[3] = a[3] + b[3] * scale2;
      return out;
    }
    function distance(a, b) {
      var x = b[0] - a[0];
      var y = b[1] - a[1];
      var z = b[2] - a[2];
      var w = b[3] - a[3];
      return Math.hypot(x, y, z, w);
    }
    function squaredDistance(a, b) {
      var x = b[0] - a[0];
      var y = b[1] - a[1];
      var z = b[2] - a[2];
      var w = b[3] - a[3];
      return x * x + y * y + z * z + w * w;
    }
    function length(a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      var w = a[3];
      return Math.hypot(x, y, z, w);
    }
    function squaredLength(a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      var w = a[3];
      return x * x + y * y + z * z + w * w;
    }
    function negate(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      out[2] = -a[2];
      out[3] = -a[3];
      return out;
    }
    function inverse(out, a) {
      out[0] = 1 / a[0];
      out[1] = 1 / a[1];
      out[2] = 1 / a[2];
      out[3] = 1 / a[3];
      return out;
    }
    function normalize(out, a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      var w = a[3];
      var len2 = x * x + y * y + z * z + w * w;
      if (len2 > 0) {
        len2 = 1 / Math.sqrt(len2);
      }
      out[0] = x * len2;
      out[1] = y * len2;
      out[2] = z * len2;
      out[3] = w * len2;
      return out;
    }
    function dot(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    }
    function cross(out, u, v, w) {
      var A = v[0] * w[1] - v[1] * w[0], B = v[0] * w[2] - v[2] * w[0], C = v[0] * w[3] - v[3] * w[0], D = v[1] * w[2] - v[2] * w[1], E = v[1] * w[3] - v[3] * w[1], F = v[2] * w[3] - v[3] * w[2];
      var G = u[0];
      var H = u[1];
      var I = u[2];
      var J = u[3];
      out[0] = H * F - I * E + J * D;
      out[1] = -(G * F) + I * C - J * B;
      out[2] = G * E - H * C + J * A;
      out[3] = -(G * D) + H * B - I * A;
      return out;
    }
    function lerp(out, a, b, t) {
      var ax = a[0];
      var ay = a[1];
      var az = a[2];
      var aw = a[3];
      out[0] = ax + t * (b[0] - ax);
      out[1] = ay + t * (b[1] - ay);
      out[2] = az + t * (b[2] - az);
      out[3] = aw + t * (b[3] - aw);
      return out;
    }
    function random(out, scale2) {
      scale2 = scale2 || 1;
      var v1, v2, v3, v4;
      var s1, s2;
      do {
        v1 = glMatrix.RANDOM() * 2 - 1;
        v2 = glMatrix.RANDOM() * 2 - 1;
        s1 = v1 * v1 + v2 * v2;
      } while (s1 >= 1);
      do {
        v3 = glMatrix.RANDOM() * 2 - 1;
        v4 = glMatrix.RANDOM() * 2 - 1;
        s2 = v3 * v3 + v4 * v4;
      } while (s2 >= 1);
      var d = Math.sqrt((1 - s1) / s2);
      out[0] = scale2 * v1;
      out[1] = scale2 * v2;
      out[2] = scale2 * v3 * d;
      out[3] = scale2 * v4 * d;
      return out;
    }
    function transformMat4(out, a, m) {
      var x = a[0], y = a[1], z = a[2], w = a[3];
      out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
      out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
      out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
      out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
      return out;
    }
    function transformQuat(out, a, q) {
      var x = a[0], y = a[1], z = a[2];
      var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      var ix = qw * x + qy * z - qz * y;
      var iy = qw * y + qz * x - qx * z;
      var iz = qw * z + qx * y - qy * x;
      var iw = -qx * x - qy * y - qz * z;
      out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
      out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
      out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
      out[3] = a[3];
      return out;
    }
    function zero(out) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      return out;
    }
    function str(a) {
      return "vec4(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ")";
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3));
    }
    var sub = subtract;
    exports.sub = sub;
    var mul = multiply;
    exports.mul = mul;
    var div = divide;
    exports.div = div;
    var dist = distance;
    exports.dist = dist;
    var sqrDist = squaredDistance;
    exports.sqrDist = sqrDist;
    var len = length;
    exports.len = len;
    var sqrLen = squaredLength;
    exports.sqrLen = sqrLen;
    var forEach = (function() {
      var vec = create();
      return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if (!stride) {
          stride = 4;
        }
        if (!offset) {
          offset = 0;
        }
        if (count) {
          l = Math.min(count * stride + offset, a.length);
        } else {
          l = a.length;
        }
        for (i = offset; i < l; i += stride) {
          vec[0] = a[i];
          vec[1] = a[i + 1];
          vec[2] = a[i + 2];
          vec[3] = a[i + 3];
          fn(vec, vec, arg);
          a[i] = vec[0];
          a[i + 1] = vec[1];
          a[i + 2] = vec[2];
          a[i + 3] = vec[3];
        }
        return a;
      };
    })();
    exports.forEach = forEach;
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/quat.js
var require_quat = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/quat.js"(exports) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof = function _typeof2(obj2) {
          return typeof obj2;
        };
      } else {
        _typeof = function _typeof2(obj2) {
          return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
        };
      }
      return _typeof(obj);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.create = create;
    exports.identity = identity;
    exports.setAxisAngle = setAxisAngle;
    exports.getAxisAngle = getAxisAngle;
    exports.getAngle = getAngle;
    exports.multiply = multiply;
    exports.rotateX = rotateX;
    exports.rotateY = rotateY;
    exports.rotateZ = rotateZ;
    exports.calculateW = calculateW;
    exports.exp = exp;
    exports.ln = ln;
    exports.pow = pow;
    exports.slerp = slerp;
    exports.random = random;
    exports.invert = invert;
    exports.conjugate = conjugate;
    exports.fromMat3 = fromMat3;
    exports.fromEuler = fromEuler;
    exports.str = str;
    exports.setAxes = exports.sqlerp = exports.rotationTo = exports.equals = exports.exactEquals = exports.normalize = exports.sqrLen = exports.squaredLength = exports.len = exports.length = exports.lerp = exports.dot = exports.scale = exports.mul = exports.add = exports.set = exports.copy = exports.fromValues = exports.clone = void 0;
    var glMatrix = _interopRequireWildcard(require_common());
    var mat3 = _interopRequireWildcard(require_mat3());
    var vec3 = _interopRequireWildcard(require_vec3());
    var vec4 = _interopRequireWildcard(require_vec4());
    function _getRequireWildcardCache(nodeInterop) {
      if (typeof WeakMap !== "function") return null;
      var cacheBabelInterop = /* @__PURE__ */ new WeakMap();
      var cacheNodeInterop = /* @__PURE__ */ new WeakMap();
      return (_getRequireWildcardCache = function _getRequireWildcardCache2(nodeInterop2) {
        return nodeInterop2 ? cacheNodeInterop : cacheBabelInterop;
      })(nodeInterop);
    }
    function _interopRequireWildcard(obj, nodeInterop) {
      if (!nodeInterop && obj && obj.__esModule) {
        return obj;
      }
      if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") {
        return { "default": obj };
      }
      var cache = _getRequireWildcardCache(nodeInterop);
      if (cache && cache.has(obj)) {
        return cache.get(obj);
      }
      var newObj = {};
      var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var key in obj) {
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
          var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
          if (desc && (desc.get || desc.set)) {
            Object.defineProperty(newObj, key, desc);
          } else {
            newObj[key] = obj[key];
          }
        }
      }
      newObj["default"] = obj;
      if (cache) {
        cache.set(obj, newObj);
      }
      return newObj;
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(4);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
      }
      out[3] = 1;
      return out;
    }
    function identity(out) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return out;
    }
    function setAxisAngle(out, axis, rad) {
      rad = rad * 0.5;
      var s = Math.sin(rad);
      out[0] = s * axis[0];
      out[1] = s * axis[1];
      out[2] = s * axis[2];
      out[3] = Math.cos(rad);
      return out;
    }
    function getAxisAngle(out_axis, q) {
      var rad = Math.acos(q[3]) * 2;
      var s = Math.sin(rad / 2);
      if (s > glMatrix.EPSILON) {
        out_axis[0] = q[0] / s;
        out_axis[1] = q[1] / s;
        out_axis[2] = q[2] / s;
      } else {
        out_axis[0] = 1;
        out_axis[1] = 0;
        out_axis[2] = 0;
      }
      return rad;
    }
    function getAngle(a, b) {
      var dotproduct = dot(a, b);
      return Math.acos(2 * dotproduct * dotproduct - 1);
    }
    function multiply(out, a, b) {
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var bx = b[0], by = b[1], bz = b[2], bw = b[3];
      out[0] = ax * bw + aw * bx + ay * bz - az * by;
      out[1] = ay * bw + aw * by + az * bx - ax * bz;
      out[2] = az * bw + aw * bz + ax * by - ay * bx;
      out[3] = aw * bw - ax * bx - ay * by - az * bz;
      return out;
    }
    function rotateX(out, a, rad) {
      rad *= 0.5;
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var bx = Math.sin(rad), bw = Math.cos(rad);
      out[0] = ax * bw + aw * bx;
      out[1] = ay * bw + az * bx;
      out[2] = az * bw - ay * bx;
      out[3] = aw * bw - ax * bx;
      return out;
    }
    function rotateY(out, a, rad) {
      rad *= 0.5;
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var by = Math.sin(rad), bw = Math.cos(rad);
      out[0] = ax * bw - az * by;
      out[1] = ay * bw + aw * by;
      out[2] = az * bw + ax * by;
      out[3] = aw * bw - ay * by;
      return out;
    }
    function rotateZ(out, a, rad) {
      rad *= 0.5;
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var bz = Math.sin(rad), bw = Math.cos(rad);
      out[0] = ax * bw + ay * bz;
      out[1] = ay * bw - ax * bz;
      out[2] = az * bw + aw * bz;
      out[3] = aw * bw - az * bz;
      return out;
    }
    function calculateW(out, a) {
      var x = a[0], y = a[1], z = a[2];
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[3] = Math.sqrt(Math.abs(1 - x * x - y * y - z * z));
      return out;
    }
    function exp(out, a) {
      var x = a[0], y = a[1], z = a[2], w = a[3];
      var r = Math.sqrt(x * x + y * y + z * z);
      var et = Math.exp(w);
      var s = r > 0 ? et * Math.sin(r) / r : 0;
      out[0] = x * s;
      out[1] = y * s;
      out[2] = z * s;
      out[3] = et * Math.cos(r);
      return out;
    }
    function ln(out, a) {
      var x = a[0], y = a[1], z = a[2], w = a[3];
      var r = Math.sqrt(x * x + y * y + z * z);
      var t = r > 0 ? Math.atan2(r, w) / r : 0;
      out[0] = x * t;
      out[1] = y * t;
      out[2] = z * t;
      out[3] = 0.5 * Math.log(x * x + y * y + z * z + w * w);
      return out;
    }
    function pow(out, a, b) {
      ln(out, a);
      scale(out, out, b);
      exp(out, out);
      return out;
    }
    function slerp(out, a, b, t) {
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var bx = b[0], by = b[1], bz = b[2], bw = b[3];
      var omega, cosom, sinom, scale0, scale1;
      cosom = ax * bx + ay * by + az * bz + aw * bw;
      if (cosom < 0) {
        cosom = -cosom;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
      }
      if (1 - cosom > glMatrix.EPSILON) {
        omega = Math.acos(cosom);
        sinom = Math.sin(omega);
        scale0 = Math.sin((1 - t) * omega) / sinom;
        scale1 = Math.sin(t * omega) / sinom;
      } else {
        scale0 = 1 - t;
        scale1 = t;
      }
      out[0] = scale0 * ax + scale1 * bx;
      out[1] = scale0 * ay + scale1 * by;
      out[2] = scale0 * az + scale1 * bz;
      out[3] = scale0 * aw + scale1 * bw;
      return out;
    }
    function random(out) {
      var u1 = glMatrix.RANDOM();
      var u2 = glMatrix.RANDOM();
      var u3 = glMatrix.RANDOM();
      var sqrt1MinusU1 = Math.sqrt(1 - u1);
      var sqrtU1 = Math.sqrt(u1);
      out[0] = sqrt1MinusU1 * Math.sin(2 * Math.PI * u2);
      out[1] = sqrt1MinusU1 * Math.cos(2 * Math.PI * u2);
      out[2] = sqrtU1 * Math.sin(2 * Math.PI * u3);
      out[3] = sqrtU1 * Math.cos(2 * Math.PI * u3);
      return out;
    }
    function invert(out, a) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var dot2 = a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
      var invDot = dot2 ? 1 / dot2 : 0;
      out[0] = -a0 * invDot;
      out[1] = -a1 * invDot;
      out[2] = -a2 * invDot;
      out[3] = a3 * invDot;
      return out;
    }
    function conjugate(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      out[2] = -a[2];
      out[3] = a[3];
      return out;
    }
    function fromMat3(out, m) {
      var fTrace = m[0] + m[4] + m[8];
      var fRoot;
      if (fTrace > 0) {
        fRoot = Math.sqrt(fTrace + 1);
        out[3] = 0.5 * fRoot;
        fRoot = 0.5 / fRoot;
        out[0] = (m[5] - m[7]) * fRoot;
        out[1] = (m[6] - m[2]) * fRoot;
        out[2] = (m[1] - m[3]) * fRoot;
      } else {
        var i = 0;
        if (m[4] > m[0]) i = 1;
        if (m[8] > m[i * 3 + i]) i = 2;
        var j = (i + 1) % 3;
        var k = (i + 2) % 3;
        fRoot = Math.sqrt(m[i * 3 + i] - m[j * 3 + j] - m[k * 3 + k] + 1);
        out[i] = 0.5 * fRoot;
        fRoot = 0.5 / fRoot;
        out[3] = (m[j * 3 + k] - m[k * 3 + j]) * fRoot;
        out[j] = (m[j * 3 + i] + m[i * 3 + j]) * fRoot;
        out[k] = (m[k * 3 + i] + m[i * 3 + k]) * fRoot;
      }
      return out;
    }
    function fromEuler(out, x, y, z) {
      var halfToRad = 0.5 * Math.PI / 180;
      x *= halfToRad;
      y *= halfToRad;
      z *= halfToRad;
      var sx = Math.sin(x);
      var cx = Math.cos(x);
      var sy = Math.sin(y);
      var cy = Math.cos(y);
      var sz = Math.sin(z);
      var cz = Math.cos(z);
      out[0] = sx * cy * cz - cx * sy * sz;
      out[1] = cx * sy * cz + sx * cy * sz;
      out[2] = cx * cy * sz - sx * sy * cz;
      out[3] = cx * cy * cz + sx * sy * sz;
      return out;
    }
    function str(a) {
      return "quat(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ")";
    }
    var clone = vec4.clone;
    exports.clone = clone;
    var fromValues = vec4.fromValues;
    exports.fromValues = fromValues;
    var copy = vec4.copy;
    exports.copy = copy;
    var set = vec4.set;
    exports.set = set;
    var add = vec4.add;
    exports.add = add;
    var mul = multiply;
    exports.mul = mul;
    var scale = vec4.scale;
    exports.scale = scale;
    var dot = vec4.dot;
    exports.dot = dot;
    var lerp = vec4.lerp;
    exports.lerp = lerp;
    var length = vec4.length;
    exports.length = length;
    var len = length;
    exports.len = len;
    var squaredLength = vec4.squaredLength;
    exports.squaredLength = squaredLength;
    var sqrLen = squaredLength;
    exports.sqrLen = sqrLen;
    var normalize = vec4.normalize;
    exports.normalize = normalize;
    var exactEquals = vec4.exactEquals;
    exports.exactEquals = exactEquals;
    var equals = vec4.equals;
    exports.equals = equals;
    var rotationTo = (function() {
      var tmpvec3 = vec3.create();
      var xUnitVec3 = vec3.fromValues(1, 0, 0);
      var yUnitVec3 = vec3.fromValues(0, 1, 0);
      return function(out, a, b) {
        var dot2 = vec3.dot(a, b);
        if (dot2 < -0.999999) {
          vec3.cross(tmpvec3, xUnitVec3, a);
          if (vec3.len(tmpvec3) < 1e-6) vec3.cross(tmpvec3, yUnitVec3, a);
          vec3.normalize(tmpvec3, tmpvec3);
          setAxisAngle(out, tmpvec3, Math.PI);
          return out;
        } else if (dot2 > 0.999999) {
          out[0] = 0;
          out[1] = 0;
          out[2] = 0;
          out[3] = 1;
          return out;
        } else {
          vec3.cross(tmpvec3, a, b);
          out[0] = tmpvec3[0];
          out[1] = tmpvec3[1];
          out[2] = tmpvec3[2];
          out[3] = 1 + dot2;
          return normalize(out, out);
        }
      };
    })();
    exports.rotationTo = rotationTo;
    var sqlerp = (function() {
      var temp1 = create();
      var temp2 = create();
      return function(out, a, b, c, d, t) {
        slerp(temp1, a, d, t);
        slerp(temp2, b, c, t);
        slerp(out, temp1, temp2, 2 * t * (1 - t));
        return out;
      };
    })();
    exports.sqlerp = sqlerp;
    var setAxes = (function() {
      var matr = mat3.create();
      return function(out, view, right, up) {
        matr[0] = right[0];
        matr[3] = right[1];
        matr[6] = right[2];
        matr[1] = up[0];
        matr[4] = up[1];
        matr[7] = up[2];
        matr[2] = -view[0];
        matr[5] = -view[1];
        matr[8] = -view[2];
        return normalize(out, fromMat3(out, matr));
      };
    })();
    exports.setAxes = setAxes;
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/quat2.js
var require_quat2 = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/quat2.js"(exports) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof = function _typeof2(obj2) {
          return typeof obj2;
        };
      } else {
        _typeof = function _typeof2(obj2) {
          return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
        };
      }
      return _typeof(obj);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.create = create;
    exports.clone = clone;
    exports.fromValues = fromValues;
    exports.fromRotationTranslationValues = fromRotationTranslationValues;
    exports.fromRotationTranslation = fromRotationTranslation;
    exports.fromTranslation = fromTranslation;
    exports.fromRotation = fromRotation;
    exports.fromMat4 = fromMat4;
    exports.copy = copy;
    exports.identity = identity;
    exports.set = set;
    exports.getDual = getDual;
    exports.setDual = setDual;
    exports.getTranslation = getTranslation;
    exports.translate = translate;
    exports.rotateX = rotateX;
    exports.rotateY = rotateY;
    exports.rotateZ = rotateZ;
    exports.rotateByQuatAppend = rotateByQuatAppend;
    exports.rotateByQuatPrepend = rotateByQuatPrepend;
    exports.rotateAroundAxis = rotateAroundAxis;
    exports.add = add;
    exports.multiply = multiply;
    exports.scale = scale;
    exports.lerp = lerp;
    exports.invert = invert;
    exports.conjugate = conjugate;
    exports.normalize = normalize;
    exports.str = str;
    exports.exactEquals = exactEquals;
    exports.equals = equals;
    exports.sqrLen = exports.squaredLength = exports.len = exports.length = exports.dot = exports.mul = exports.setReal = exports.getReal = void 0;
    var glMatrix = _interopRequireWildcard(require_common());
    var quat = _interopRequireWildcard(require_quat());
    var mat4 = _interopRequireWildcard(require_mat4());
    function _getRequireWildcardCache(nodeInterop) {
      if (typeof WeakMap !== "function") return null;
      var cacheBabelInterop = /* @__PURE__ */ new WeakMap();
      var cacheNodeInterop = /* @__PURE__ */ new WeakMap();
      return (_getRequireWildcardCache = function _getRequireWildcardCache2(nodeInterop2) {
        return nodeInterop2 ? cacheNodeInterop : cacheBabelInterop;
      })(nodeInterop);
    }
    function _interopRequireWildcard(obj, nodeInterop) {
      if (!nodeInterop && obj && obj.__esModule) {
        return obj;
      }
      if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") {
        return { "default": obj };
      }
      var cache = _getRequireWildcardCache(nodeInterop);
      if (cache && cache.has(obj)) {
        return cache.get(obj);
      }
      var newObj = {};
      var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var key in obj) {
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
          var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
          if (desc && (desc.get || desc.set)) {
            Object.defineProperty(newObj, key, desc);
          } else {
            newObj[key] = obj[key];
          }
        }
      }
      newObj["default"] = obj;
      if (cache) {
        cache.set(obj, newObj);
      }
      return newObj;
    }
    function create() {
      var dq = new glMatrix.ARRAY_TYPE(8);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        dq[0] = 0;
        dq[1] = 0;
        dq[2] = 0;
        dq[4] = 0;
        dq[5] = 0;
        dq[6] = 0;
        dq[7] = 0;
      }
      dq[3] = 1;
      return dq;
    }
    function clone(a) {
      var dq = new glMatrix.ARRAY_TYPE(8);
      dq[0] = a[0];
      dq[1] = a[1];
      dq[2] = a[2];
      dq[3] = a[3];
      dq[4] = a[4];
      dq[5] = a[5];
      dq[6] = a[6];
      dq[7] = a[7];
      return dq;
    }
    function fromValues(x1, y1, z1, w1, x2, y2, z2, w2) {
      var dq = new glMatrix.ARRAY_TYPE(8);
      dq[0] = x1;
      dq[1] = y1;
      dq[2] = z1;
      dq[3] = w1;
      dq[4] = x2;
      dq[5] = y2;
      dq[6] = z2;
      dq[7] = w2;
      return dq;
    }
    function fromRotationTranslationValues(x1, y1, z1, w1, x2, y2, z2) {
      var dq = new glMatrix.ARRAY_TYPE(8);
      dq[0] = x1;
      dq[1] = y1;
      dq[2] = z1;
      dq[3] = w1;
      var ax = x2 * 0.5, ay = y2 * 0.5, az = z2 * 0.5;
      dq[4] = ax * w1 + ay * z1 - az * y1;
      dq[5] = ay * w1 + az * x1 - ax * z1;
      dq[6] = az * w1 + ax * y1 - ay * x1;
      dq[7] = -ax * x1 - ay * y1 - az * z1;
      return dq;
    }
    function fromRotationTranslation(out, q, t) {
      var ax = t[0] * 0.5, ay = t[1] * 0.5, az = t[2] * 0.5, bx = q[0], by = q[1], bz = q[2], bw = q[3];
      out[0] = bx;
      out[1] = by;
      out[2] = bz;
      out[3] = bw;
      out[4] = ax * bw + ay * bz - az * by;
      out[5] = ay * bw + az * bx - ax * bz;
      out[6] = az * bw + ax * by - ay * bx;
      out[7] = -ax * bx - ay * by - az * bz;
      return out;
    }
    function fromTranslation(out, t) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      out[4] = t[0] * 0.5;
      out[5] = t[1] * 0.5;
      out[6] = t[2] * 0.5;
      out[7] = 0;
      return out;
    }
    function fromRotation(out, q) {
      out[0] = q[0];
      out[1] = q[1];
      out[2] = q[2];
      out[3] = q[3];
      out[4] = 0;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      return out;
    }
    function fromMat4(out, a) {
      var outer = quat.create();
      mat4.getRotation(outer, a);
      var t = new glMatrix.ARRAY_TYPE(3);
      mat4.getTranslation(t, a);
      fromRotationTranslation(out, outer, t);
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      return out;
    }
    function identity(out) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      out[4] = 0;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      return out;
    }
    function set(out, x1, y1, z1, w1, x2, y2, z2, w2) {
      out[0] = x1;
      out[1] = y1;
      out[2] = z1;
      out[3] = w1;
      out[4] = x2;
      out[5] = y2;
      out[6] = z2;
      out[7] = w2;
      return out;
    }
    var getReal = quat.copy;
    exports.getReal = getReal;
    function getDual(out, a) {
      out[0] = a[4];
      out[1] = a[5];
      out[2] = a[6];
      out[3] = a[7];
      return out;
    }
    var setReal = quat.copy;
    exports.setReal = setReal;
    function setDual(out, q) {
      out[4] = q[0];
      out[5] = q[1];
      out[6] = q[2];
      out[7] = q[3];
      return out;
    }
    function getTranslation(out, a) {
      var ax = a[4], ay = a[5], az = a[6], aw = a[7], bx = -a[0], by = -a[1], bz = -a[2], bw = a[3];
      out[0] = (ax * bw + aw * bx + ay * bz - az * by) * 2;
      out[1] = (ay * bw + aw * by + az * bx - ax * bz) * 2;
      out[2] = (az * bw + aw * bz + ax * by - ay * bx) * 2;
      return out;
    }
    function translate(out, a, v) {
      var ax1 = a[0], ay1 = a[1], az1 = a[2], aw1 = a[3], bx1 = v[0] * 0.5, by1 = v[1] * 0.5, bz1 = v[2] * 0.5, ax2 = a[4], ay2 = a[5], az2 = a[6], aw2 = a[7];
      out[0] = ax1;
      out[1] = ay1;
      out[2] = az1;
      out[3] = aw1;
      out[4] = aw1 * bx1 + ay1 * bz1 - az1 * by1 + ax2;
      out[5] = aw1 * by1 + az1 * bx1 - ax1 * bz1 + ay2;
      out[6] = aw1 * bz1 + ax1 * by1 - ay1 * bx1 + az2;
      out[7] = -ax1 * bx1 - ay1 * by1 - az1 * bz1 + aw2;
      return out;
    }
    function rotateX(out, a, rad) {
      var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7], ax1 = ax * bw + aw * bx + ay * bz - az * by, ay1 = ay * bw + aw * by + az * bx - ax * bz, az1 = az * bw + aw * bz + ax * by - ay * bx, aw1 = aw * bw - ax * bx - ay * by - az * bz;
      quat.rotateX(out, a, rad);
      bx = out[0];
      by = out[1];
      bz = out[2];
      bw = out[3];
      out[4] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
      out[5] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
      out[6] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
      out[7] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
      return out;
    }
    function rotateY(out, a, rad) {
      var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7], ax1 = ax * bw + aw * bx + ay * bz - az * by, ay1 = ay * bw + aw * by + az * bx - ax * bz, az1 = az * bw + aw * bz + ax * by - ay * bx, aw1 = aw * bw - ax * bx - ay * by - az * bz;
      quat.rotateY(out, a, rad);
      bx = out[0];
      by = out[1];
      bz = out[2];
      bw = out[3];
      out[4] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
      out[5] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
      out[6] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
      out[7] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
      return out;
    }
    function rotateZ(out, a, rad) {
      var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7], ax1 = ax * bw + aw * bx + ay * bz - az * by, ay1 = ay * bw + aw * by + az * bx - ax * bz, az1 = az * bw + aw * bz + ax * by - ay * bx, aw1 = aw * bw - ax * bx - ay * by - az * bz;
      quat.rotateZ(out, a, rad);
      bx = out[0];
      by = out[1];
      bz = out[2];
      bw = out[3];
      out[4] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
      out[5] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
      out[6] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
      out[7] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
      return out;
    }
    function rotateByQuatAppend(out, a, q) {
      var qx = q[0], qy = q[1], qz = q[2], qw = q[3], ax = a[0], ay = a[1], az = a[2], aw = a[3];
      out[0] = ax * qw + aw * qx + ay * qz - az * qy;
      out[1] = ay * qw + aw * qy + az * qx - ax * qz;
      out[2] = az * qw + aw * qz + ax * qy - ay * qx;
      out[3] = aw * qw - ax * qx - ay * qy - az * qz;
      ax = a[4];
      ay = a[5];
      az = a[6];
      aw = a[7];
      out[4] = ax * qw + aw * qx + ay * qz - az * qy;
      out[5] = ay * qw + aw * qy + az * qx - ax * qz;
      out[6] = az * qw + aw * qz + ax * qy - ay * qx;
      out[7] = aw * qw - ax * qx - ay * qy - az * qz;
      return out;
    }
    function rotateByQuatPrepend(out, q, a) {
      var qx = q[0], qy = q[1], qz = q[2], qw = q[3], bx = a[0], by = a[1], bz = a[2], bw = a[3];
      out[0] = qx * bw + qw * bx + qy * bz - qz * by;
      out[1] = qy * bw + qw * by + qz * bx - qx * bz;
      out[2] = qz * bw + qw * bz + qx * by - qy * bx;
      out[3] = qw * bw - qx * bx - qy * by - qz * bz;
      bx = a[4];
      by = a[5];
      bz = a[6];
      bw = a[7];
      out[4] = qx * bw + qw * bx + qy * bz - qz * by;
      out[5] = qy * bw + qw * by + qz * bx - qx * bz;
      out[6] = qz * bw + qw * bz + qx * by - qy * bx;
      out[7] = qw * bw - qx * bx - qy * by - qz * bz;
      return out;
    }
    function rotateAroundAxis(out, a, axis, rad) {
      if (Math.abs(rad) < glMatrix.EPSILON) {
        return copy(out, a);
      }
      var axisLength = Math.hypot(axis[0], axis[1], axis[2]);
      rad = rad * 0.5;
      var s = Math.sin(rad);
      var bx = s * axis[0] / axisLength;
      var by = s * axis[1] / axisLength;
      var bz = s * axis[2] / axisLength;
      var bw = Math.cos(rad);
      var ax1 = a[0], ay1 = a[1], az1 = a[2], aw1 = a[3];
      out[0] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
      out[1] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
      out[2] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
      out[3] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
      var ax = a[4], ay = a[5], az = a[6], aw = a[7];
      out[4] = ax * bw + aw * bx + ay * bz - az * by;
      out[5] = ay * bw + aw * by + az * bx - ax * bz;
      out[6] = az * bw + aw * bz + ax * by - ay * bx;
      out[7] = aw * bw - ax * bx - ay * by - az * bz;
      return out;
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      out[4] = a[4] + b[4];
      out[5] = a[5] + b[5];
      out[6] = a[6] + b[6];
      out[7] = a[7] + b[7];
      return out;
    }
    function multiply(out, a, b) {
      var ax0 = a[0], ay0 = a[1], az0 = a[2], aw0 = a[3], bx1 = b[4], by1 = b[5], bz1 = b[6], bw1 = b[7], ax1 = a[4], ay1 = a[5], az1 = a[6], aw1 = a[7], bx0 = b[0], by0 = b[1], bz0 = b[2], bw0 = b[3];
      out[0] = ax0 * bw0 + aw0 * bx0 + ay0 * bz0 - az0 * by0;
      out[1] = ay0 * bw0 + aw0 * by0 + az0 * bx0 - ax0 * bz0;
      out[2] = az0 * bw0 + aw0 * bz0 + ax0 * by0 - ay0 * bx0;
      out[3] = aw0 * bw0 - ax0 * bx0 - ay0 * by0 - az0 * bz0;
      out[4] = ax0 * bw1 + aw0 * bx1 + ay0 * bz1 - az0 * by1 + ax1 * bw0 + aw1 * bx0 + ay1 * bz0 - az1 * by0;
      out[5] = ay0 * bw1 + aw0 * by1 + az0 * bx1 - ax0 * bz1 + ay1 * bw0 + aw1 * by0 + az1 * bx0 - ax1 * bz0;
      out[6] = az0 * bw1 + aw0 * bz1 + ax0 * by1 - ay0 * bx1 + az1 * bw0 + aw1 * bz0 + ax1 * by0 - ay1 * bx0;
      out[7] = aw0 * bw1 - ax0 * bx1 - ay0 * by1 - az0 * bz1 + aw1 * bw0 - ax1 * bx0 - ay1 * by0 - az1 * bz0;
      return out;
    }
    var mul = multiply;
    exports.mul = mul;
    function scale(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      out[4] = a[4] * b;
      out[5] = a[5] * b;
      out[6] = a[6] * b;
      out[7] = a[7] * b;
      return out;
    }
    var dot = quat.dot;
    exports.dot = dot;
    function lerp(out, a, b, t) {
      var mt = 1 - t;
      if (dot(a, b) < 0) t = -t;
      out[0] = a[0] * mt + b[0] * t;
      out[1] = a[1] * mt + b[1] * t;
      out[2] = a[2] * mt + b[2] * t;
      out[3] = a[3] * mt + b[3] * t;
      out[4] = a[4] * mt + b[4] * t;
      out[5] = a[5] * mt + b[5] * t;
      out[6] = a[6] * mt + b[6] * t;
      out[7] = a[7] * mt + b[7] * t;
      return out;
    }
    function invert(out, a) {
      var sqlen = squaredLength(a);
      out[0] = -a[0] / sqlen;
      out[1] = -a[1] / sqlen;
      out[2] = -a[2] / sqlen;
      out[3] = a[3] / sqlen;
      out[4] = -a[4] / sqlen;
      out[5] = -a[5] / sqlen;
      out[6] = -a[6] / sqlen;
      out[7] = a[7] / sqlen;
      return out;
    }
    function conjugate(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      out[2] = -a[2];
      out[3] = a[3];
      out[4] = -a[4];
      out[5] = -a[5];
      out[6] = -a[6];
      out[7] = a[7];
      return out;
    }
    var length = quat.length;
    exports.length = length;
    var len = length;
    exports.len = len;
    var squaredLength = quat.squaredLength;
    exports.squaredLength = squaredLength;
    var sqrLen = squaredLength;
    exports.sqrLen = sqrLen;
    function normalize(out, a) {
      var magnitude = squaredLength(a);
      if (magnitude > 0) {
        magnitude = Math.sqrt(magnitude);
        var a0 = a[0] / magnitude;
        var a1 = a[1] / magnitude;
        var a2 = a[2] / magnitude;
        var a3 = a[3] / magnitude;
        var b0 = a[4];
        var b1 = a[5];
        var b2 = a[6];
        var b3 = a[7];
        var a_dot_b = a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
        out[0] = a0;
        out[1] = a1;
        out[2] = a2;
        out[3] = a3;
        out[4] = (b0 - a0 * a_dot_b) / magnitude;
        out[5] = (b1 - a1 * a_dot_b) / magnitude;
        out[6] = (b2 - a2 * a_dot_b) / magnitude;
        out[7] = (b3 - a3 * a_dot_b) / magnitude;
      }
      return out;
    }
    function str(a) {
      return "quat2(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ", " + a[6] + ", " + a[7] + ")";
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= glMatrix.EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= glMatrix.EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5)) && Math.abs(a6 - b6) <= glMatrix.EPSILON * Math.max(1, Math.abs(a6), Math.abs(b6)) && Math.abs(a7 - b7) <= glMatrix.EPSILON * Math.max(1, Math.abs(a7), Math.abs(b7));
    }
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/vec2.js
var require_vec2 = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/vec2.js"(exports) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof = function _typeof2(obj2) {
          return typeof obj2;
        };
      } else {
        _typeof = function _typeof2(obj2) {
          return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
        };
      }
      return _typeof(obj);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.create = create;
    exports.clone = clone;
    exports.fromValues = fromValues;
    exports.copy = copy;
    exports.set = set;
    exports.add = add;
    exports.subtract = subtract;
    exports.multiply = multiply;
    exports.divide = divide;
    exports.ceil = ceil;
    exports.floor = floor;
    exports.min = min;
    exports.max = max;
    exports.round = round;
    exports.scale = scale;
    exports.scaleAndAdd = scaleAndAdd;
    exports.distance = distance;
    exports.squaredDistance = squaredDistance;
    exports.length = length;
    exports.squaredLength = squaredLength;
    exports.negate = negate;
    exports.inverse = inverse;
    exports.normalize = normalize;
    exports.dot = dot;
    exports.cross = cross;
    exports.lerp = lerp;
    exports.random = random;
    exports.transformMat2 = transformMat2;
    exports.transformMat2d = transformMat2d;
    exports.transformMat3 = transformMat3;
    exports.transformMat4 = transformMat4;
    exports.rotate = rotate;
    exports.angle = angle;
    exports.zero = zero;
    exports.str = str;
    exports.exactEquals = exactEquals;
    exports.equals = equals;
    exports.forEach = exports.sqrLen = exports.sqrDist = exports.dist = exports.div = exports.mul = exports.sub = exports.len = void 0;
    var glMatrix = _interopRequireWildcard(require_common());
    function _getRequireWildcardCache(nodeInterop) {
      if (typeof WeakMap !== "function") return null;
      var cacheBabelInterop = /* @__PURE__ */ new WeakMap();
      var cacheNodeInterop = /* @__PURE__ */ new WeakMap();
      return (_getRequireWildcardCache = function _getRequireWildcardCache2(nodeInterop2) {
        return nodeInterop2 ? cacheNodeInterop : cacheBabelInterop;
      })(nodeInterop);
    }
    function _interopRequireWildcard(obj, nodeInterop) {
      if (!nodeInterop && obj && obj.__esModule) {
        return obj;
      }
      if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") {
        return { "default": obj };
      }
      var cache = _getRequireWildcardCache(nodeInterop);
      if (cache && cache.has(obj)) {
        return cache.get(obj);
      }
      var newObj = {};
      var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var key in obj) {
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
          var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
          if (desc && (desc.get || desc.set)) {
            Object.defineProperty(newObj, key, desc);
          } else {
            newObj[key] = obj[key];
          }
        }
      }
      newObj["default"] = obj;
      if (cache) {
        cache.set(obj, newObj);
      }
      return newObj;
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(2);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[0] = 0;
        out[1] = 0;
      }
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(2);
      out[0] = a[0];
      out[1] = a[1];
      return out;
    }
    function fromValues(x, y) {
      var out = new glMatrix.ARRAY_TYPE(2);
      out[0] = x;
      out[1] = y;
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      return out;
    }
    function set(out, x, y) {
      out[0] = x;
      out[1] = y;
      return out;
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      return out;
    }
    function multiply(out, a, b) {
      out[0] = a[0] * b[0];
      out[1] = a[1] * b[1];
      return out;
    }
    function divide(out, a, b) {
      out[0] = a[0] / b[0];
      out[1] = a[1] / b[1];
      return out;
    }
    function ceil(out, a) {
      out[0] = Math.ceil(a[0]);
      out[1] = Math.ceil(a[1]);
      return out;
    }
    function floor(out, a) {
      out[0] = Math.floor(a[0]);
      out[1] = Math.floor(a[1]);
      return out;
    }
    function min(out, a, b) {
      out[0] = Math.min(a[0], b[0]);
      out[1] = Math.min(a[1], b[1]);
      return out;
    }
    function max(out, a, b) {
      out[0] = Math.max(a[0], b[0]);
      out[1] = Math.max(a[1], b[1]);
      return out;
    }
    function round(out, a) {
      out[0] = Math.round(a[0]);
      out[1] = Math.round(a[1]);
      return out;
    }
    function scale(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      return out;
    }
    function scaleAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      return out;
    }
    function distance(a, b) {
      var x = b[0] - a[0], y = b[1] - a[1];
      return Math.hypot(x, y);
    }
    function squaredDistance(a, b) {
      var x = b[0] - a[0], y = b[1] - a[1];
      return x * x + y * y;
    }
    function length(a) {
      var x = a[0], y = a[1];
      return Math.hypot(x, y);
    }
    function squaredLength(a) {
      var x = a[0], y = a[1];
      return x * x + y * y;
    }
    function negate(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      return out;
    }
    function inverse(out, a) {
      out[0] = 1 / a[0];
      out[1] = 1 / a[1];
      return out;
    }
    function normalize(out, a) {
      var x = a[0], y = a[1];
      var len2 = x * x + y * y;
      if (len2 > 0) {
        len2 = 1 / Math.sqrt(len2);
      }
      out[0] = a[0] * len2;
      out[1] = a[1] * len2;
      return out;
    }
    function dot(a, b) {
      return a[0] * b[0] + a[1] * b[1];
    }
    function cross(out, a, b) {
      var z = a[0] * b[1] - a[1] * b[0];
      out[0] = out[1] = 0;
      out[2] = z;
      return out;
    }
    function lerp(out, a, b, t) {
      var ax = a[0], ay = a[1];
      out[0] = ax + t * (b[0] - ax);
      out[1] = ay + t * (b[1] - ay);
      return out;
    }
    function random(out, scale2) {
      scale2 = scale2 || 1;
      var r = glMatrix.RANDOM() * 2 * Math.PI;
      out[0] = Math.cos(r) * scale2;
      out[1] = Math.sin(r) * scale2;
      return out;
    }
    function transformMat2(out, a, m) {
      var x = a[0], y = a[1];
      out[0] = m[0] * x + m[2] * y;
      out[1] = m[1] * x + m[3] * y;
      return out;
    }
    function transformMat2d(out, a, m) {
      var x = a[0], y = a[1];
      out[0] = m[0] * x + m[2] * y + m[4];
      out[1] = m[1] * x + m[3] * y + m[5];
      return out;
    }
    function transformMat3(out, a, m) {
      var x = a[0], y = a[1];
      out[0] = m[0] * x + m[3] * y + m[6];
      out[1] = m[1] * x + m[4] * y + m[7];
      return out;
    }
    function transformMat4(out, a, m) {
      var x = a[0];
      var y = a[1];
      out[0] = m[0] * x + m[4] * y + m[12];
      out[1] = m[1] * x + m[5] * y + m[13];
      return out;
    }
    function rotate(out, a, b, rad) {
      var p0 = a[0] - b[0], p1 = a[1] - b[1], sinC = Math.sin(rad), cosC = Math.cos(rad);
      out[0] = p0 * cosC - p1 * sinC + b[0];
      out[1] = p0 * sinC + p1 * cosC + b[1];
      return out;
    }
    function angle(a, b) {
      var x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1], mag = Math.sqrt(x1 * x1 + y1 * y1) * Math.sqrt(x2 * x2 + y2 * y2), cosine = mag && (x1 * x2 + y1 * y2) / mag;
      return Math.acos(Math.min(Math.max(cosine, -1), 1));
    }
    function zero(out) {
      out[0] = 0;
      out[1] = 0;
      return out;
    }
    function str(a) {
      return "vec2(" + a[0] + ", " + a[1] + ")";
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1];
      var b0 = b[0], b1 = b[1];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1));
    }
    var len = length;
    exports.len = len;
    var sub = subtract;
    exports.sub = sub;
    var mul = multiply;
    exports.mul = mul;
    var div = divide;
    exports.div = div;
    var dist = distance;
    exports.dist = dist;
    var sqrDist = squaredDistance;
    exports.sqrDist = sqrDist;
    var sqrLen = squaredLength;
    exports.sqrLen = sqrLen;
    var forEach = (function() {
      var vec = create();
      return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if (!stride) {
          stride = 2;
        }
        if (!offset) {
          offset = 0;
        }
        if (count) {
          l = Math.min(count * stride + offset, a.length);
        } else {
          l = a.length;
        }
        for (i = offset; i < l; i += stride) {
          vec[0] = a[i];
          vec[1] = a[i + 1];
          fn(vec, vec, arg);
          a[i] = vec[0];
          a[i + 1] = vec[1];
        }
        return a;
      };
    })();
    exports.forEach = forEach;
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/index.js
var require_cjs = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/gl-matrix@3.4.3/node_modules/gl-matrix/cjs/index.js"(exports) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof = function _typeof2(obj2) {
          return typeof obj2;
        };
      } else {
        _typeof = function _typeof2(obj2) {
          return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
        };
      }
      return _typeof(obj);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.vec4 = exports.vec3 = exports.vec2 = exports.quat2 = exports.quat = exports.mat4 = exports.mat3 = exports.mat2d = exports.mat2 = exports.glMatrix = void 0;
    var glMatrix = _interopRequireWildcard(require_common());
    exports.glMatrix = glMatrix;
    var mat2 = _interopRequireWildcard(require_mat2());
    exports.mat2 = mat2;
    var mat2d = _interopRequireWildcard(require_mat2d());
    exports.mat2d = mat2d;
    var mat3 = _interopRequireWildcard(require_mat3());
    exports.mat3 = mat3;
    var mat4 = _interopRequireWildcard(require_mat4());
    exports.mat4 = mat4;
    var quat = _interopRequireWildcard(require_quat());
    exports.quat = quat;
    var quat2 = _interopRequireWildcard(require_quat2());
    exports.quat2 = quat2;
    var vec2 = _interopRequireWildcard(require_vec2());
    exports.vec2 = vec2;
    var vec3 = _interopRequireWildcard(require_vec3());
    exports.vec3 = vec3;
    var vec4 = _interopRequireWildcard(require_vec4());
    exports.vec4 = vec4;
    function _getRequireWildcardCache(nodeInterop) {
      if (typeof WeakMap !== "function") return null;
      var cacheBabelInterop = /* @__PURE__ */ new WeakMap();
      var cacheNodeInterop = /* @__PURE__ */ new WeakMap();
      return (_getRequireWildcardCache = function _getRequireWildcardCache2(nodeInterop2) {
        return nodeInterop2 ? cacheNodeInterop : cacheBabelInterop;
      })(nodeInterop);
    }
    function _interopRequireWildcard(obj, nodeInterop) {
      if (!nodeInterop && obj && obj.__esModule) {
        return obj;
      }
      if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") {
        return { "default": obj };
      }
      var cache = _getRequireWildcardCache(nodeInterop);
      if (cache && cache.has(obj)) {
        return cache.get(obj);
      }
      var newObj = {};
      var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var key in obj) {
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
          var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
          if (desc && (desc.get || desc.set)) {
            Object.defineProperty(newObj, key, desc);
          } else {
            newObj[key] = obj[key];
          }
        }
      }
      newObj["default"] = obj;
      if (cache) {
        cache.set(obj, newObj);
      }
      return newObj;
    }
  }
});

// ../dao3 max/box3-local-engine/packages/utils/build/helper.js
var require_helper = __commonJS({
  "../dao3 max/box3-local-engine/packages/utils/build/helper.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FaceModeSelectOption = exports.FaceModeColorOption = exports.CenterModeOption = exports.colorSelectOptions = exports.EditingMode = exports.Actions = exports.WorkAction = void 0;
    exports.generateCuboid = generateCuboid;
    exports.boundary = boundary;
    exports.surfaceScale = surfaceScale;
    exports.hex2rgb = hex2rgb;
    exports.absMod = absMod;
    exports.traverseVoxels = traverseVoxels;
    exports.inRange = inRange;
    exports.adjacentVoxels = adjacentVoxels;
    exports.drawVoxelSphere = drawVoxelSphere;
    exports.drawVoxelCircle = drawVoxelCircle;
    exports.drawVoxelSquare = drawVoxelSquare;
    exports.calcRadius = calcRadius;
    exports.calcHalfEdgeLen = calcHalfEdgeLen;
    exports.drawVoxelLine = drawVoxelLine;
    exports.cloneArray = cloneArray;
    exports.newBundle = newBundle;
    exports.fillSpace = fillSpace;
    exports.allocEmptyVoxels = allocEmptyVoxels;
    exports.getElementPos = getElementPos;
    exports.mergeVoxel = mergeVoxel;
    exports.surfaceByNormalAndPoint = surfaceByNormalAndPoint;
    var voxel_1 = require_voxel();
    var gl_matrix_1 = require_cjs();
    var WorkAction;
    (function(WorkAction2) {
      WorkAction2[WorkAction2["bakeAoData"] = 0] = "bakeAoData";
      WorkAction2[WorkAction2["syncVoxel"] = 1] = "syncVoxel";
      WorkAction2[WorkAction2["updateVoxel"] = 2] = "updateVoxel";
      WorkAction2[WorkAction2["sendPoints"] = 3] = "sendPoints";
      WorkAction2[WorkAction2["clearData"] = 4] = "clearData";
      WorkAction2[WorkAction2["changeSize"] = 5] = "changeSize";
    })(WorkAction || (exports.WorkAction = WorkAction = {}));
    var Actions;
    (function(Actions2) {
      Actions2[Actions2["Attach"] = 0] = "Attach";
      Actions2[Actions2["Erase"] = 1] = "Erase";
      Actions2[Actions2["Paint"] = 2] = "Paint";
      Actions2[Actions2["Select"] = 3] = "Select";
      Actions2[Actions2["Translate"] = 4] = "Translate";
      Actions2[Actions2["ColorSelect"] = 5] = "ColorSelect";
      Actions2[Actions2["PickColor"] = 6] = "PickColor";
      Actions2[Actions2["HollowOut"] = 7] = "HollowOut";
      Actions2[Actions2["FillSameColorSpace"] = 8] = "FillSameColorSpace";
      Actions2[Actions2["Extrude"] = 9] = "Extrude";
    })(Actions || (exports.Actions = Actions = {}));
    var EditingMode;
    (function(EditingMode2) {
      EditingMode2[EditingMode2["line"] = 0] = "line";
      EditingMode2[EditingMode2["center"] = 1] = "center";
      EditingMode2[EditingMode2["box"] = 2] = "box";
      EditingMode2[EditingMode2["voxel"] = 3] = "voxel";
      EditingMode2[EditingMode2["face"] = 4] = "face";
      EditingMode2[EditingMode2["rect"] = 5] = "rect";
    })(EditingMode || (exports.EditingMode = EditingMode = {}));
    var colorSelectOptions;
    (function(colorSelectOptions2) {
      colorSelectOptions2[colorSelectOptions2["volume"] = 0] = "volume";
      colorSelectOptions2[colorSelectOptions2["face"] = 1] = "face";
      colorSelectOptions2[colorSelectOptions2["all"] = 2] = "all";
    })(colorSelectOptions || (exports.colorSelectOptions = colorSelectOptions = {}));
    var CenterModeOption;
    (function(CenterModeOption2) {
      CenterModeOption2[CenterModeOption2["square"] = 0] = "square";
      CenterModeOption2[CenterModeOption2["circle"] = 1] = "circle";
    })(CenterModeOption || (exports.CenterModeOption = CenterModeOption = {}));
    var FaceModeColorOption;
    (function(FaceModeColorOption2) {
      FaceModeColorOption2[FaceModeColorOption2["voxelColor"] = 0] = "voxelColor";
      FaceModeColorOption2[FaceModeColorOption2["currentColor"] = 1] = "currentColor";
    })(FaceModeColorOption || (exports.FaceModeColorOption = FaceModeColorOption = {}));
    var FaceModeSelectOption;
    (function(FaceModeSelectOption2) {
      FaceModeSelectOption2[FaceModeSelectOption2["geometry"] = 0] = "geometry";
      FaceModeSelectOption2[FaceModeSelectOption2["colorGeometry"] = 1] = "colorGeometry";
    })(FaceModeSelectOption || (exports.FaceModeSelectOption = FaceModeSelectOption = {}));
    function generateCuboid(a, b, isVoxle, outerNormal, range) {
      const { start, end } = boundary(a, b, [-Infinity, -Infinity, -Infinity], [Infinity, Infinity, Infinity]);
      const positions = [];
      const elements = [];
      const normals = [];
      const nSign = outerNormal ? -1 : 1;
      if (isVoxle) {
        for (let i = 0; i < 3; i++) {
          if (range) {
            end[i] = Math.min(end[i] + 1, range[i]);
          } else {
            end[i] = end[i] + 1;
          }
        }
      }
      positions.push([start[0], start[1], start[2]]);
      positions.push([start[0], start[1], end[2]]);
      positions.push([end[0], start[1], end[2]]);
      positions.push([end[0], start[1], start[2]]);
      positions.push([start[0], end[1], start[2]]);
      positions.push([end[0], end[1], start[2]]);
      positions.push([end[0], end[1], end[2]]);
      positions.push([start[0], end[1], end[2]]);
      positions.push([end[0], start[1], start[2]]);
      positions.push([end[0], start[1], end[2]]);
      positions.push([end[0], end[1], end[2]]);
      positions.push([end[0], end[1], start[2]]);
      positions.push([start[0], start[1], start[2]]);
      positions.push([start[0], end[1], start[2]]);
      positions.push([start[0], end[1], end[2]]);
      positions.push([start[0], start[1], end[2]]);
      positions.push([start[0], start[1], start[2]]);
      positions.push([end[0], start[1], start[2]]);
      positions.push([end[0], end[1], start[2]]);
      positions.push([start[0], end[1], start[2]]);
      positions.push([start[0], start[1], end[2]]);
      positions.push([start[0], end[1], end[2]]);
      positions.push([end[0], end[1], end[2]]);
      positions.push([end[0], start[1], end[2]]);
      for (let i = 0; i < 4; i++) {
        normals.push([0, 1 * nSign, 0]);
      }
      for (let i = 0; i < 4; i++) {
        normals.push([0, -1 * nSign, 0]);
      }
      for (let i = 0; i < 4; i++) {
        normals.push([-1 * nSign, 0, 0]);
      }
      for (let i = 0; i < 4; i++) {
        normals.push([1 * nSign, 0, 0]);
      }
      for (let i = 0; i < 4; i++) {
        normals.push([0, 0, 1 * nSign]);
      }
      for (let i = 0; i < 4; i++) {
        normals.push([0, 0, -1 * nSign]);
      }
      const surfaceIndex = [0, 4, 8, 12, 16, 20];
      for (let i = 0; i < surfaceIndex.length; i++) {
        if (nSign == -1) {
          elements.push([
            surfaceIndex[i] + 2,
            surfaceIndex[i] + 1,
            surfaceIndex[i]
          ]);
          elements.push([
            surfaceIndex[i],
            surfaceIndex[i] + 3,
            surfaceIndex[i] + 2
          ]);
        } else {
          elements.push([
            surfaceIndex[i],
            surfaceIndex[i] + 1,
            surfaceIndex[i] + 2
          ]);
          elements.push([
            surfaceIndex[i] + 2,
            surfaceIndex[i] + 3,
            surfaceIndex[i]
          ]);
        }
      }
      return {
        lo: [start[0], start[1], start[2]],
        hi: [end[0], end[1], end[2]],
        positions,
        elements,
        normals
      };
    }
    function boundary(a, b, minima, maxima) {
      const start = gl_matrix_1.vec3.create();
      const end = gl_matrix_1.vec3.create();
      gl_matrix_1.vec3.max(start, gl_matrix_1.vec3.min(start, a, b), minima);
      gl_matrix_1.vec3.min(end, gl_matrix_1.vec3.max(end, a, b), maxima);
      return {
        start,
        end
      };
    }
    function surfaceScale(normal, surface, scale) {
      const min = Math.min;
      const offset = [surface[0][0], surface[0][1], surface[0][2]];
      for (let i = 1; i < surface.length; i++) {
        offset[0] = min(offset[0], surface[i][0]);
        offset[1] = min(offset[1], surface[i][1]);
        offset[2] = min(offset[2], surface[i][2]);
      }
      const out = [];
      for (let i = 0; i < surface.length; i++) {
        const pos = [0, 0, 0];
        if (normal[0] == 0) {
          pos[0] = (surface[i][0] - offset[0]) * scale - scale / 2;
        } else if (normal[0] != 0) {
          pos[0] = surface[0][0];
        }
        if (normal[1] == 0) {
          pos[1] = (surface[i][1] - offset[1]) * scale - scale / 2;
        } else if (normal[1] != 0) {
          pos[1] = surface[0][1];
        }
        if (normal[2] == 0) {
          pos[2] = (surface[i][2] - offset[2]) * scale - scale / 2;
        } else if (normal[2] != 0) {
          pos[2] = surface[0][2];
        }
        out.push(pos);
      }
      return out;
    }
    function hex2rgb(hex) {
      if (hex[0] == "#") {
        hex = hex.substr(1);
      }
      return [
        parseInt(hex.substr(0, 2), 16),
        parseInt(hex.substr(2, 2), 16),
        parseInt(hex.substr(4, 2), 16)
      ];
    }
    function absMod(n, mod) {
      if (n < 0) {
        n = Math.ceil(Math.abs(n / mod)) * mod + n;
      } else {
        n %= mod;
      }
      return n;
    }
    function traverseVoxels(voxel, start, end, operation) {
      const { data, stride: [sx, sy, sz], offset } = voxel;
      const l = end[0] - start[0] + 1;
      const h = end[1] - start[1] + 1;
      const stepi = sx;
      const stepj = sy - sx * l;
      const stepk = sz - sy * h;
      let ptr = sx * start[0] + sy * start[1] + sz * start[2] + offset;
      for (let k = start[2]; k <= end[2]; ++k) {
        for (let j = start[1]; j <= end[1]; ++j) {
          for (let i = start[0]; i <= end[0]; ++i) {
            operation(i, j, k, data[ptr], ptr);
            ptr += stepi;
          }
          ptr += stepj;
        }
        ptr += stepk;
      }
    }
    function inRange(position, minimum, maximum) {
      const [x, y, z] = position;
      const [minX, minY, minZ] = minimum;
      const [maxX, maxY, maxZ] = maximum;
      return x >= minX && y >= minY && z >= minZ && x <= maxX && y <= maxY && z <= maxZ;
    }
    function adjacentVoxels(src, out, currentPos, value, currentMaterial, axis, start, end, normal) {
      const queue = [];
      queue.push(currentPos);
      const maximum = [src.shape[0] - 1, src.shape[1] - 1, src.shape[2] - 1];
      while (queue.length) {
        const [x, y, z] = queue.pop();
        if (!inRange([x, y, z], [0, 0, 0], maximum)) {
          continue;
        }
        if (normal && inRange([x + normal[0], y + normal[1], z + normal[2]], [0, 0, 0], maximum)) {
          if (src.getVoxel(x + normal[0], y + normal[1], z + normal[2]) !== 0) {
            continue;
          }
        }
        if (value === -1) {
          const index = out.index(x, y, z);
          if (out.data[index] != 0) {
            continue;
          }
          if (src.data[index] !== 0) {
            out.data[index] = src.data[index];
          } else {
            continue;
          }
        } else if (value === 0) {
          if (out.getVoxel(x, y, z) === currentMaterial) {
            continue;
          }
          if (src.getVoxel(x, y, z) === 0) {
            out.setVoxel(x, y, z, currentMaterial);
            src.setVoxel(x, y, z, currentMaterial);
          } else {
            continue;
          }
        } else {
          if (out.getVoxel(x, y, z) === value) {
            continue;
          }
          if (src.getVoxel(x, y, z) === value) {
            out.setVoxel(x, y, z, value);
          } else {
            continue;
          }
        }
        gl_matrix_1.vec3.min(start, start, [x, y, z]);
        gl_matrix_1.vec3.max(end, end, [x, y, z]);
        if (axis[0] != 0) {
          queue.push([x + 1, y, z]);
          queue.push([x - 1, y, z]);
        }
        if (axis[1] != 0) {
          queue.push([x, y + 1, z]);
          queue.push([x, y - 1, z]);
        }
        if (axis[2] != 0) {
          queue.push([x, y, z + 1]);
          queue.push([x, y, z - 1]);
        }
      }
    }
    function drawVoxelSphere(voxels, center, radius) {
      for (let i = 0; i < radius; i++) {
        for (let j = 0; j < radius; j++) {
          for (let k = 0; k < radius; k++) {
            if (i * i + j * j + k * k < radius * radius) {
              voxels.setVoxel(center[0] + i, center[1] + j, center[2] + k, 1);
              voxels.setVoxel(center[0] - i, center[1] + j, center[2] + k, 1);
              voxels.setVoxel(center[0] + i, center[1] - j, center[2] + k, 1);
              voxels.setVoxel(center[0] + i, center[1] + j, center[2] - k, 1);
              voxels.setVoxel(center[0] - i, center[1] - j, center[2] + k, 1);
              voxels.setVoxel(center[0] - i, center[1] - j, center[2] - k, 1);
              voxels.setVoxel(center[0] + i, center[1] - j, center[2] - k, 1);
              voxels.setVoxel(center[0] - i, center[1] + j, center[2] - k, 1);
            }
          }
        }
      }
    }
    function drawVoxelCircle(voxels, color, center, radius, N_axis, visitor) {
      let a = 0;
      let b = radius;
      let p = 5 / 4 - radius;
      if (typeof N_axis !== "string") {
        if (N_axis[0] != 0) {
          N_axis = "x";
        } else if (N_axis[1] != 0) {
          N_axis = "y";
        } else if (N_axis[2] != 0) {
          N_axis = "z";
        }
      }
      while (a <= b) {
        if (p < 0) {
          p = p + 2 * a + 3;
          a++;
        } else {
          p = p + 2 * (a - b) + 5;
          b--;
          a++;
        }
        if (N_axis === "z") {
          for (let i = center[0] - a; i <= center[0] + a; i++) {
            visitor(i, center[1] + b, center[2]);
            visitor(i, center[1] - b, center[2]);
          }
          for (let i = center[0] - b; i <= center[0] + b; i++) {
            visitor(i, center[1] + a, center[2]);
            visitor(i, center[1] - a, center[2]);
          }
          for (let i = center[0] - radius; i <= center[0] + radius; i++) {
            if (i != center[0]) {
              visitor(i, center[1], center[2]);
            }
          }
        } else if (N_axis === "y") {
          for (let i = center[2] - a; i <= center[2] + a; i++) {
            visitor(center[0] + b, center[1], i);
            visitor(center[0] - b, center[1], i);
          }
          for (let i = center[2] - b; i <= center[2] + b; i++) {
            visitor(center[0] + a, center[1], i);
            visitor(center[0] - a, center[1], i);
          }
          for (let i = center[2] - radius; i <= center[2] + radius; i++) {
            if (i != center[2]) {
              visitor(center[0], center[1], i);
            }
          }
        } else if (N_axis === "x") {
          for (let i = center[2] - a; i <= center[2] + a; i++) {
            visitor(center[0], center[1] + b, i);
            visitor(center[0], center[1] - b, i);
          }
          for (let i = center[2] - b; i <= center[2] + b; i++) {
            visitor(center[0], center[1] + a, i);
            visitor(center[0], center[1] - a, i);
          }
          for (let i = center[2] - radius; i <= center[2] + radius; i++) {
            if (i != center[2]) {
              visitor(center[0], center[1], i);
            }
          }
        }
      }
    }
    function drawVoxelSquare(voxels, color, center, halfEdgeLen, N_axis, force = false) {
      if (typeof N_axis !== "string") {
        if (N_axis[0] != 0) {
          N_axis = "x";
        } else if (N_axis[1] != 0) {
          N_axis = "y";
        } else if (N_axis[2] != 0) {
          N_axis = "z";
        }
      }
      if (N_axis === "z") {
        for (let i = center[0] - halfEdgeLen; i <= center[0] + halfEdgeLen; i++) {
          for (let j = center[1] - halfEdgeLen; j <= center[1] + halfEdgeLen; j++) {
            if (i != center[0] || j != center[1]) {
              const idx = voxels.index(i, j, center[2]);
              if (idx > -1) {
                voxels.data[idx] = force ? color : voxels.data[idx] || color;
              }
            }
          }
        }
      } else if (N_axis === "y") {
        for (let i = center[0] - halfEdgeLen; i <= center[0] + halfEdgeLen; i++) {
          for (let k = center[2] - halfEdgeLen; k <= center[2] + halfEdgeLen; k++) {
            if (i != center[0] || k != center[2]) {
              const idx = voxels.index(i, center[1], k);
              if (idx > -1) {
                voxels.data[idx] = force ? color : voxels.data[idx] || color;
              }
            }
          }
        }
      } else if (N_axis === "x") {
        for (let j = center[1] - halfEdgeLen; j <= center[1] + halfEdgeLen; j++) {
          for (let k = center[2] - halfEdgeLen; k <= center[2] + halfEdgeLen; k++) {
            if (j != center[1] || k != center[2]) {
              const idx = voxels.index(center[0], j, k);
              if (idx > -1) {
                voxels.data[idx] = force ? color : voxels.data[idx] || color;
              }
            }
          }
        }
      }
    }
    function calcRadius(N_axis, center, pos) {
      if (N_axis[0] != 0) {
        const _dy = pos[1] - center[1];
        const _dz = pos[2] - center[2];
        return Math.round(Math.pow(_dy * _dy + _dz * _dz, 0.5));
      } else if (N_axis[1] != 0) {
        const _dx = pos[0] - center[0];
        const _dz = pos[2] - center[2];
        return Math.round(Math.pow(_dx * _dx + _dz * _dz, 0.5));
      } else if (N_axis[2] != 0) {
        const _dx = pos[0] - center[0];
        const _dy = pos[1] - center[1];
        return Math.round(Math.pow(_dx * _dx + _dy * _dy, 0.5));
      }
      return 0;
    }
    function calcHalfEdgeLen(N_axis, center, pos) {
      if (N_axis[0] != 0) {
        const _dy = Math.abs(pos[1] - center[1]);
        const _dz = Math.abs(pos[2] - center[2]);
        return Math.max(_dy, _dz);
      } else if (N_axis[1] != 0) {
        const _dx = Math.abs(pos[0] - center[0]);
        const _dz = Math.abs(pos[2] - center[2]);
        return Math.max(_dx, _dz);
      } else if (N_axis[2] != 0) {
        const _dx = Math.abs(pos[0] - center[0]);
        const _dy = Math.abs(pos[1] - center[1]);
        return Math.max(_dx, _dy);
      }
      return 0;
    }
    function drawVoxelLine(startP, endP, visitor) {
      const minX = Math.min(startP[0], endP[0]);
      const minY = Math.min(startP[1], endP[1]);
      const minZ = Math.min(startP[2], endP[2]);
      const maxX = Math.max(startP[0], endP[0]);
      const maxY = Math.max(startP[1], endP[1]);
      const maxZ = Math.max(startP[2], endP[2]);
      let dx = +(endP[0] - startP[0]);
      let dy = +(endP[1] - startP[1]);
      let dz = +(endP[2] - startP[2]);
      const s = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2) + Math.pow(dz, 2));
      dx = dx / s;
      dy = dy / s;
      dz = dz / s;
      const txDelta = Math.abs(1 / dx);
      const tyDelta = Math.abs(1 / dy);
      const tzDelta = Math.abs(1 / dz);
      let txMax = txDelta < Infinity ? Math.abs(dx) + 1 : Infinity;
      let tyMax = tyDelta < Infinity ? Math.abs(dy) + 1 : Infinity;
      let tzMax = tzDelta < Infinity ? Math.abs(dz) + 1 : Infinity;
      const stepx = dx < 0 ? -1 : dx > 0 ? 1 : 0;
      const stepy = dy < 0 ? -1 : dy > 0 ? 1 : 0;
      const stepz = dz < 0 ? -1 : dz > 0 ? 1 : 0;
      let [x, y, z] = startP;
      while (true) {
        visitor(x, y, z);
        if (x == endP[0] && y == endP[1] && z == endP[2]) {
          return;
        }
        if (txMax < tyMax) {
          if (txMax < tzMax) {
            x = x + stepx;
            if (x < minX || x > maxX) {
              return;
            }
            txMax = txMax + txDelta;
          } else {
            z = z + stepz;
            if (z < minZ || z > maxZ) {
              return;
            }
            tzMax = tzMax + tzDelta;
          }
        } else {
          if (tyMax < tzMax) {
            y = y + stepy;
            if (y < minY || y > maxY) {
              return;
            }
            tyMax = tyMax + tyDelta;
          } else {
            z = z + stepz;
            if (z < minZ || z > maxZ) {
              return;
            }
            tzMax = tzMax + tzDelta;
          }
        }
      }
    }
    function cloneArray(x) {
      const result = new Array(x.length);
      for (let i = 0; i < x.length; ++i) {
        result[i] = x[i].slice();
      }
      return result;
    }
    function getSubSpace(as, ae, bs, be) {
      const max = Math.max;
      const min = Math.min;
      const intersectS = [max(as[0], bs[0]), max(as[1], bs[1]), max(as[2], bs[2])];
      const intersectE = [min(ae[0], be[0]), min(ae[1], be[1]), min(ae[2], be[2])];
      if (!(intersectS[0] < intersectE[0] && intersectS[1] < intersectE[1] && intersectS[2] < intersectE[2])) {
        return { eliminate: [[as, ae]], addition: [[bs, be]] };
      }
      const eliminateSpace = [];
      [
        [as, [intersectE[0], ae[1], intersectS[2]]],
        [
          [intersectE[0] + 1, as[1], as[2]],
          [ae[0], ae[1], intersectE[2]]
        ],
        [
          [as[0], as[1], intersectS[2]],
          [intersectS[0] - 1, ae[1], ae[2]]
        ],
        [[intersectS[0], as[1], intersectE[2]], ae],
        [
          [intersectS[0], as[1], intersectS[2]],
          [intersectE[0], intersectS[1] - 1, intersectE[2]]
        ],
        [
          [intersectS[0], intersectE[1] + 1, intersectS[2]],
          [intersectE[0], ae[1], intersectE[2]]
        ]
      ].forEach((points) => {
        for (let i = 0; i < points[0].length; i++) {
          if (points[1][i] - points[0][i] < 0) {
            return;
          }
        }
        eliminateSpace.push(points);
      });
      const additionSpace = [];
      [
        [bs, [intersectE[0], be[1], intersectS[2]]],
        [
          [intersectE[0] + 1, bs[1], bs[2]],
          [be[0], be[1], intersectE[2]]
        ],
        [
          [bs[0], bs[1], intersectS[2]],
          [intersectS[0] - 1, be[1], be[2]]
        ],
        [[intersectS[0], bs[1], intersectE[2]], be],
        [
          [intersectS[0], bs[1], intersectS[2]],
          [intersectE[0], intersectS[1] - 1, intersectE[2]]
        ],
        [
          [intersectS[0], intersectE[1] + 1, intersectS[2]],
          [intersectE[0], be[1], intersectE[2]]
        ]
      ].forEach((points) => {
        for (let i = 0; i < points[0].length; i++) {
          if (points[1][i] - points[0][i] < 0) {
            return;
          }
        }
        additionSpace.push(points);
      });
      return { eliminate: eliminateSpace, addition: additionSpace };
    }
    function newBundle(voxel, prevStart, prevEnd, start, end, eliminateMaterial, newMaterial, condition) {
      const currBound = boundary(start, end, [0, 0, 0], voxel.getDimension());
      const [minX, minY, minZ] = currBound.start;
      const [maxX, maxY, maxZ] = currBound.end;
      if (prevStart && prevStart.length == 3) {
        const prevBound = boundary(prevStart, prevEnd, [0, 0, 0], voxel.getDimension());
        const [preMinX, preMinY, preMinZ] = prevBound.start;
        const [preMaxX, preMaxY, preMaxZ] = prevBound.end;
        const rst = getSubSpace([preMinX, preMinY, preMinZ], [preMaxX, preMaxY, preMaxZ], [minX, minY, minZ], [maxX, maxY, maxZ]);
        rst.eliminate.forEach((pos) => {
          fillSpace(voxel, pos[0], pos[1], eliminateMaterial);
        });
        rst.addition.forEach((pos) => {
          fillSpace(voxel, pos[0], pos[1], newMaterial, condition);
        });
      } else {
        for (let i = minX; i <= maxX; i++) {
          for (let j = minY; j <= maxY; j++) {
            for (let k = minZ; k <= maxZ; k++) {
              if (typeof newMaterial == "function") {
                voxel.setVoxel(i, j, k, newMaterial(i, j, k));
              } else {
                voxel.setVoxel(i, j, k, newMaterial);
              }
            }
          }
        }
      }
      return voxel;
    }
    function fillSpace(voxel, start, end, material, condition) {
      const getTextureId = typeof material === "function" ? material : () => material;
      const onCondition = typeof condition === "function" ? condition : () => true;
      traverseVoxels(voxel, start, end, (i, j, k) => {
        if (!onCondition(i, j, k)) {
          return;
        }
        voxel.setVoxel(i, j, k, getTextureId(i, j, k));
      });
    }
    function allocEmptyVoxels(x, y, z) {
      const voxels = (0, voxel_1.allocVoxels)(x, y, z);
      for (let i = 0; i < voxels.data.length; i++) {
        voxels.data[i] = 0;
      }
      return voxels;
    }
    function getElementPos(e) {
      let x = 0;
      let y = 0;
      while (e != null) {
        x += e.offsetLeft;
        y += e.offsetTop;
        e = e.offsetParent;
      }
      return {
        x,
        y
      };
    }
    function mergeVoxel(a, b, start, end, type = 1) {
      const bound = boundary(start, end, [0, 0, 0], a.shape.map((v) => v - 1));
      const [minX, minY, minZ] = bound.start;
      const [maxX, maxY, maxZ] = bound.end;
      for (let i = minX; i <= maxX; i++) {
        for (let j = minY; j <= maxY; j++) {
          for (let k = minZ; k <= maxZ; k++) {
            if (type === 1) {
              if (a.getVoxel(i, j, k) == 0) {
                a.setVoxel(i, j, k, b.getVoxel(i, j, k));
              }
            } else if (type === 2) {
              a.setVoxel(i, j, k, b.getVoxel(i, j, k));
            } else if (type === 3) {
              if (b.getVoxel(i, j, k) != 0) {
                a.setVoxel(i, j, k, b.getVoxel(i, j, k));
              }
            } else if (type === 4) {
              if (b.getVoxel(i, j, k) != 0) {
                a.setVoxel(i, j, k, b.getVoxel(i, j, k));
                b.setVoxel(i, j, k, 0);
              }
            } else if (type === 5) {
              if (a.getVoxel(i, j, k) == 0) {
                a.setVoxel(i, j, k, b.getVoxel(i, j, k));
                b.setVoxel(i, j, k, 0);
              }
            }
          }
        }
      }
      return function(c, s, e, t = 1) {
        return mergeVoxel(a, c, s, e, t);
      };
    }
    function surfaceByNormalAndPoint(p, q) {
      const tris = [];
      const A = q[0] - p[0];
      const B = q[1] - p[1];
      const C = q[2] - p[2];
      const Cx = p[0];
      const Cy = p[1];
      const Cz = p[2];
      const maxDN = Math.max(Math.abs(A), Math.abs(B), Math.abs(C));
      let vertices;
      const v = 2e3;
      if (maxDN === Math.abs(A)) {
        if (A > 0) {
          vertices = [
            [v, v],
            [-v, v],
            [-v, -v],
            [v, -v]
          ];
        } else {
          vertices = [
            [v, v],
            [v, -v],
            [-v, -v],
            [-v, v]
          ];
        }
        for (let i = 0; i < vertices.length; i++) {
          const y = vertices[i][0];
          const z = vertices[i][1];
          const x = Cx - (B * (y - Cy) + C * (z - Cz)) / A;
          tris.push([x, y, z]);
        }
      } else if (maxDN === Math.abs(B)) {
        if (B > 0) {
          vertices = [
            [v, v],
            [v, -v],
            [-v, -v],
            [-v, v]
          ];
        } else {
          vertices = [
            [v, v],
            [-v, v],
            [-v, -v],
            [v, -v]
          ];
        }
        for (let i = 0; i < vertices.length; i++) {
          const x = vertices[i][0];
          const z = vertices[i][1];
          const y = Cy - (A * (x - Cx) + C * (z - Cz)) / B;
          tris.push([x, y, z]);
        }
      } else {
        if (C > 0) {
          vertices = [
            [v, v],
            [-v, v],
            [-v, -v],
            [v, -v]
          ];
        } else if (C < 0) {
          vertices = [
            [v, v],
            [v, -v],
            [-v, -v],
            [-v, v]
          ];
        } else {
          throw new Error("C should not be zero");
        }
        for (let i = 0; i < vertices.length; i++) {
          const x = vertices[i][0];
          const y = vertices[i][1];
          const z = Cz - (A * (x - Cx) + B * (y - Cy)) / C;
          tris.push([x, y, z]);
        }
      }
      return tris;
    }
  }
});

// ../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/bit-twiddle@1.0.2/node_modules/bit-twiddle/twiddle.js
var require_twiddle = __commonJS({
  "../dao3 max/box3-local-engine/common/temp/node_modules/.pnpm/bit-twiddle@1.0.2/node_modules/bit-twiddle/twiddle.js"(exports) {
    "use strict";
    "use restrict";
    var INT_BITS = 32;
    exports.INT_BITS = INT_BITS;
    exports.INT_MAX = 2147483647;
    exports.INT_MIN = -1 << INT_BITS - 1;
    exports.sign = function(v) {
      return (v > 0) - (v < 0);
    };
    exports.abs = function(v) {
      var mask = v >> INT_BITS - 1;
      return (v ^ mask) - mask;
    };
    exports.min = function(x, y) {
      return y ^ (x ^ y) & -(x < y);
    };
    exports.max = function(x, y) {
      return x ^ (x ^ y) & -(x < y);
    };
    exports.isPow2 = function(v) {
      return !(v & v - 1) && !!v;
    };
    exports.log2 = function(v) {
      var r, shift;
      r = (v > 65535) << 4;
      v >>>= r;
      shift = (v > 255) << 3;
      v >>>= shift;
      r |= shift;
      shift = (v > 15) << 2;
      v >>>= shift;
      r |= shift;
      shift = (v > 3) << 1;
      v >>>= shift;
      r |= shift;
      return r | v >> 1;
    };
    exports.log10 = function(v) {
      return v >= 1e9 ? 9 : v >= 1e8 ? 8 : v >= 1e7 ? 7 : v >= 1e6 ? 6 : v >= 1e5 ? 5 : v >= 1e4 ? 4 : v >= 1e3 ? 3 : v >= 100 ? 2 : v >= 10 ? 1 : 0;
    };
    exports.popCount = function(v) {
      v = v - (v >>> 1 & 1431655765);
      v = (v & 858993459) + (v >>> 2 & 858993459);
      return (v + (v >>> 4) & 252645135) * 16843009 >>> 24;
    };
    function countTrailingZeros(v) {
      var c = 32;
      v &= -v;
      if (v) c--;
      if (v & 65535) c -= 16;
      if (v & 16711935) c -= 8;
      if (v & 252645135) c -= 4;
      if (v & 858993459) c -= 2;
      if (v & 1431655765) c -= 1;
      return c;
    }
    exports.countTrailingZeros = countTrailingZeros;
    exports.nextPow2 = function(v) {
      v += v === 0;
      --v;
      v |= v >>> 1;
      v |= v >>> 2;
      v |= v >>> 4;
      v |= v >>> 8;
      v |= v >>> 16;
      return v + 1;
    };
    exports.prevPow2 = function(v) {
      v |= v >>> 1;
      v |= v >>> 2;
      v |= v >>> 4;
      v |= v >>> 8;
      v |= v >>> 16;
      return v - (v >>> 1);
    };
    exports.parity = function(v) {
      v ^= v >>> 16;
      v ^= v >>> 8;
      v ^= v >>> 4;
      v &= 15;
      return 27030 >>> v & 1;
    };
    var REVERSE_TABLE = new Array(256);
    (function(tab) {
      for (var i = 0; i < 256; ++i) {
        var v = i, r = i, s = 7;
        for (v >>>= 1; v; v >>>= 1) {
          r <<= 1;
          r |= v & 1;
          --s;
        }
        tab[i] = r << s & 255;
      }
    })(REVERSE_TABLE);
    exports.reverse = function(v) {
      return REVERSE_TABLE[v & 255] << 24 | REVERSE_TABLE[v >>> 8 & 255] << 16 | REVERSE_TABLE[v >>> 16 & 255] << 8 | REVERSE_TABLE[v >>> 24 & 255];
    };
    exports.interleave2 = function(x, y) {
      x &= 65535;
      x = (x | x << 8) & 16711935;
      x = (x | x << 4) & 252645135;
      x = (x | x << 2) & 858993459;
      x = (x | x << 1) & 1431655765;
      y &= 65535;
      y = (y | y << 8) & 16711935;
      y = (y | y << 4) & 252645135;
      y = (y | y << 2) & 858993459;
      y = (y | y << 1) & 1431655765;
      return x | y << 1;
    };
    exports.deinterleave2 = function(v, n) {
      v = v >>> n & 1431655765;
      v = (v | v >>> 1) & 858993459;
      v = (v | v >>> 2) & 252645135;
      v = (v | v >>> 4) & 16711935;
      v = (v | v >>> 16) & 65535;
      return v << 16 >> 16;
    };
    exports.interleave3 = function(x, y, z) {
      x &= 1023;
      x = (x | x << 16) & 4278190335;
      x = (x | x << 8) & 251719695;
      x = (x | x << 4) & 3272356035;
      x = (x | x << 2) & 1227133513;
      y &= 1023;
      y = (y | y << 16) & 4278190335;
      y = (y | y << 8) & 251719695;
      y = (y | y << 4) & 3272356035;
      y = (y | y << 2) & 1227133513;
      x |= y << 1;
      z &= 1023;
      z = (z | z << 16) & 4278190335;
      z = (z | z << 8) & 251719695;
      z = (z | z << 4) & 3272356035;
      z = (z | z << 2) & 1227133513;
      return x | z << 2;
    };
    exports.deinterleave3 = function(v, n) {
      v = v >>> n & 1227133513;
      v = (v | v >>> 2) & 3272356035;
      v = (v | v >>> 4) & 251719695;
      v = (v | v >>> 8) & 4278190335;
      v = (v | v >>> 16) & 1023;
      return v << 22 >> 22;
    };
    exports.nextCombination = function(v) {
      var t = v | v - 1;
      return t + 1 | (~t & -~t) - 1 >>> countTrailingZeros(v) + 1;
    };
  }
});

// ../dao3 max/box3-local-engine/packages/utils/build/pool.js
var require_pool = __commonJS({
  "../dao3 max/box3-local-engine/packages/utils/build/pool.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.alloc = alloc;
    exports.free = free;
    exports.cloneU8 = cloneU8;
    exports.clearMemoryPool = clearMemoryPool;
    var bit_twiddle_1 = require_twiddle();
    var pool = new Array(32);
    for (let i = 0; i < 32; ++i) {
      pool[i] = [];
    }
    function alloc(size) {
      const sz = (0, bit_twiddle_1.nextPow2)(size);
      const bin = pool[(0, bit_twiddle_1.log2)(sz)];
      const mem = bin.pop();
      if (mem) {
        return mem;
      } else {
        return new Uint8Array(sz).buffer;
      }
    }
    function free(buffer) {
      pool[(0, bit_twiddle_1.log2)(buffer.byteLength)].push(buffer);
    }
    function cloneU8(data) {
      const sz = (0, bit_twiddle_1.nextPow2)(data.length);
      const bin = pool[(0, bit_twiddle_1.log2)(sz)];
      const mem = bin.pop();
      if (mem) {
        const result = new Uint8Array(mem);
        result.set(data);
        return result;
      } else {
        return new Uint8Array(data);
      }
    }
    function clearMemoryPool() {
      for (let i = 0; i < pool.length; ++i) {
        pool[i].length = 0;
      }
    }
  }
});

// ../dao3 max/box3-local-engine/packages/utils/build/rle-compress.js
var require_rle_compress = __commonJS({
  "../dao3 max/box3-local-engine/packages/utils/build/rle-compress.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.compress = compress;
    exports.decompress = decompress;
    exports.sectionDecompress = sectionDecompress;
    exports.old_decompress = old_decompress;
    function writeRun(out, runLength, block) {
      if (runLength) {
        out.grow(10);
        out.writeVarint(runLength - 1);
        out.writeVarint(block);
      }
    }
    function compress(voxels, out) {
      const { data, shape: [nx, ny, nz], stride: [sx, sy, sz], offset } = voxels;
      let prevBlock = -1;
      let runLength = 0;
      let ptr = offset;
      const stepi = sx;
      const stepj = sy - sx * nx;
      const stepk = sz - sy * ny;
      for (let k = 0; k < nz; ++k) {
        for (let j = 0; j < ny; ++j) {
          for (let i = 0; i < nx; ++i) {
            const b = data[ptr];
            if (b !== prevBlock) {
              writeRun(out, runLength, prevBlock);
              runLength = 0;
              prevBlock = b;
            }
            runLength += 1;
            ptr += stepi;
          }
          ptr += stepj;
        }
        ptr += stepk;
      }
      writeRun(out, runLength, prevBlock);
      return true;
    }
    function fastDecompress(inp, data, count) {
      for (let ptr = 0; ptr < count; ) {
        const length = inp.readVarint() + 1;
        const block = inp.readVarint();
        for (let i = 0; i < length; ++i) {
          data[ptr++] = block;
        }
      }
      return true;
    }
    function decompress(inp, voxels) {
      const { data, shape: [nx, ny, nz], stride: [sx, sy, sz], offset } = voxels;
      let curBlock = -1;
      let curLength = 0;
      if (sx === 1 && sy === nx && sz === nx * ny && offset === 0) {
        return fastDecompress(inp, data, nx * ny * nz);
      }
      let ptr = offset;
      const stepi = sx;
      const stepj = sy - sx * nx;
      const stepk = sz - sy * ny;
      for (let k = 0; k < nz; ++k) {
        for (let j = 0; j < ny; ++j) {
          for (let i = 0; i < nx; ++i) {
            if (curLength <= 0) {
              curLength = inp.readVarint() + 1;
              curBlock = inp.readVarint();
            }
            data[ptr] = curBlock;
            curLength -= 1;
            ptr += stepi;
          }
          ptr += stepj;
        }
        ptr += stepk;
      }
      return curLength === 0;
    }
    function sectionDecompress(rle, voxels, start, end) {
      const { data, stride: [sx, sy, sz], offset } = voxels;
      const rleLength = rle.length;
      let curBlock = -1;
      let curLength = 0;
      let rlePtr = 0;
      const l = end[0] - start[0] + 1;
      const h = end[1] - start[1] + 1;
      const stepi = sx;
      const stepj = sy - sx * l;
      const stepk = sz - sy * h;
      let ptr = sx * start[0] + sy * start[1] + sz * start[2] + offset;
      for (let k = start[2]; k <= end[2]; k++) {
        for (let j = start[1]; j <= end[1]; j++) {
          for (let i = start[0]; i <= end[0]; i++) {
            if (curLength <= 0) {
              if (rlePtr >= rleLength) {
                return false;
              }
              const runPrefix = rle[rlePtr++];
              if (runPrefix < 255) {
                curLength = runPrefix;
              } else {
                if (rlePtr + 1 >= rleLength) {
                  return false;
                }
                curLength = (rle[rlePtr] << 8) + rle[rlePtr + 1];
                rlePtr += 2;
              }
              if (rlePtr >= rleLength) {
                return false;
              }
              const blockPrefix = rle[rlePtr++];
              if (blockPrefix < 255) {
                curBlock = blockPrefix;
              } else {
                if (rlePtr + 1 >= rleLength) {
                  return false;
                }
                curBlock = (rle[rlePtr] << 8) + rle[rlePtr + 1];
                rlePtr += 2;
              }
            }
            data[ptr] = curBlock;
            curLength -= 1;
            ptr += stepi;
          }
          ptr += stepj;
        }
        ptr += stepk;
      }
      return rlePtr === rle.length && curLength === 0;
    }
    function old_decompress(rle, voxels) {
      return sectionDecompress(rle, voxels, [0, 0, 0], voxels.shape.map((v) => v - 1));
    }
  }
});

// ../dao3 max/box3-local-engine/packages/utils/build/voxel.js
var require_voxel = __commonJS({
  "../dao3 max/box3-local-engine/packages/utils/build/voxel.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.VoxelView = void 0;
    exports.getBoxBoundary = getBoxBoundary;
    exports.allocVoxels = allocVoxels;
    exports.freeVoxels = freeVoxels;
    exports.cloneVoxels = cloneVoxels;
    exports.storeVoxels = storeVoxels;
    exports.restoreVoxels = restoreVoxels;
    exports.flipVoxels = flipVoxels;
    exports.isEmptyVoxels = isEmptyVoxels;
    var gl_matrix_1 = require_cjs();
    var helper_1 = require_helper();
    var pool_1 = require_pool();
    var rle_compress_1 = require_rle_compress();
    var TEMP_UINT16ARRAY = new Uint16Array();
    var VoxelView2 = class _VoxelView {
      constructor(data, shape, stride, offset, dataStart, dataEnd, dataStride) {
        this.getVoxelByPtr = (ptr) => {
          if (!this.dataStart || !this.dataEnd || !this.dataStride) {
            return this.data[ptr];
          }
          const z = Math.floor(ptr / this.stride[2]);
          const y = Math.floor(ptr % this.stride[2] / this.stride[1]);
          const x = ptr % this.stride[1];
          if (!this.contains(x, y, z, this.dataStart, this.dataEnd)) {
            return 0;
          }
          return this.data[this.dataStride[0] * (x - this.dataStart[0]) + this.dataStride[1] * (y - this.dataStart[1]) + this.dataStride[2] * (z - this.dataStart[2])];
        };
        this.setVoxelByPtr = (ptr, b) => {
          if (!this.dataStart || !this.dataEnd || !this.dataStride) {
            return this.data[ptr] = b;
          }
          const z = Math.floor(ptr / this.stride[2]);
          const y = Math.floor(ptr % this.stride[2] / this.stride[1]);
          const x = ptr % this.stride[1];
          if (!this.contains(x, y, z, this.dataStart, this.dataEnd)) {
            return 0;
          }
          return this.data[this.dataStride[0] * (x - this.dataStart[0]) + this.dataStride[1] * (y - this.dataStart[1]) + this.dataStride[2] * (z - this.dataStart[2])] = b;
        };
        this.data = data;
        this.shape = shape;
        this.stride = stride;
        this.offset = offset | 0;
        this.dataStart = dataStart;
        this.dataEnd = dataEnd;
        this.dataStride = dataStride;
      }
      getVoxel(x, y, z) {
        return this.getVoxelByPtr(this.index(x, y, z));
      }
      getVoxels() {
        const voxels = [];
        (0, helper_1.traverseVoxels)(this, [0, 0, 0], this.shape.map((v) => v - 1), (i, j, k, d) => {
          if (d != 0) {
            voxels.push([i, j, k]);
          }
        });
        return voxels;
      }
      getDimension() {
        return gl_matrix_1.vec3.add(gl_matrix_1.vec3.clone(this.shape), this.shape, [-1, -1, -1]);
      }
      index(x, y, z) {
        return this.stride[0] * x + this.stride[1] * y + this.stride[2] * z + this.offset;
      }
      contains(x, y, z, start, end) {
        return x >= start[0] && x < end[0] && y >= start[1] && y < end[1] && z >= start[2] && z < end[2];
      }
      setVoxel(x, y, z, b) {
        return this.setVoxelByPtr(this.index(x, y, z), b);
      }
      setVoxelRotate(x, y, z, rotate) {
        const b = this.getVoxel(x, y, z) | rotate << 14;
        return this.data[this.stride[0] * x + this.stride[1] * y + this.stride[2] * z + this.offset] = b;
      }
      slice(lo, hi) {
        return new _VoxelView(this.data, [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], this.stride, this.offset + this.stride[0] * lo[0] + this.stride[1] * lo[1] + this.stride[2] * lo[2], this.dataStart, this.dataEnd, this.dataStride);
      }
      transpose(px, py, pz) {
        return new _VoxelView(this.data, [this.shape[px], this.shape[py], this.shape[pz]], [this.stride[px], this.stride[py], this.stride[pz]], this.offset);
      }
      step(sx, sy, sz) {
        return new _VoxelView(this.data, [
          Math.floor(this.shape[0] / sx),
          Math.floor(this.shape[1] / sy),
          Math.floor(this.shape[2] / sz)
        ], [this.stride[0] * sx, this.stride[1] * sy, this.stride[2] * sz], this.offset);
      }
      copy(other) {
        const [nx_, ny_, nz_] = this.shape;
        const [mx_, my_, mz_] = other.shape;
        const nx = Math.min(nx_, mx_);
        const ny = Math.min(ny_, my_);
        const nz = Math.min(nz_, mz_);
        const tdata = this.data;
        const [tx, ty, tz] = this.stride;
        let tptr = this.offset;
        const dtdi = tx;
        const dtdj = ty - nx * tx;
        const dtdk = tz - ny * ty;
        const sdata = other.data;
        const [sx, sy, sz] = other.stride;
        let sptr = other.offset;
        const dsdi = sx;
        const dsdj = sy - nx * sx;
        const dsdk = sz - ny * sy;
        for (let k = 0; k < nz; ++k) {
          for (let j = 0; j < ny; ++j) {
            for (let i = 0; i < nx; ++i) {
              tdata[tptr] = sdata[sptr];
              tptr += dtdi;
              sptr += dsdi;
            }
            tptr += dtdj;
            sptr += dsdj;
          }
          tptr += dtdk;
          sptr += dsdk;
        }
      }
      fill(b) {
        const [nx, ny, nz] = this.shape;
        const tdata = this.data;
        const [tx, ty, tz] = this.stride;
        let tptr = this.offset;
        const dtdi = tx;
        const dtdj = ty - nx * tx;
        const dtdk = tz - ny * ty;
        for (let k = 0; k < nz; ++k) {
          for (let j = 0; j < ny; ++j) {
            for (let i = 0; i < nx; ++i) {
              tdata[tptr] = b;
              tptr += dtdi;
            }
            tptr += dtdj;
          }
          tptr += dtdk;
        }
      }
      equals(other) {
        if (this.shape[0] !== other.shape[0] || this.shape[1] !== other.shape[1] || this.shape[2] !== other.shape[2]) {
          return false;
        }
        const [nx, ny, nz] = this.shape;
        const tdata = this.data;
        const [tx, ty, tz] = this.stride;
        let tptr = this.offset;
        const dtdi = tx;
        const dtdj = ty - nx * tx;
        const dtdk = tz - ny * ty;
        const sdata = other.data;
        const [sx, sy, sz] = other.stride;
        let sptr = other.offset;
        const dsdi = sx;
        const dsdj = sy - nx * sx;
        const dsdk = sz - ny * sy;
        for (let k = 0; k < nz; ++k) {
          for (let j = 0; j < ny; ++j) {
            for (let i = 0; i < nx; ++i) {
              if (tdata[tptr] !== sdata[sptr]) {
                return false;
              }
              tptr += dtdi;
              sptr += dsdi;
            }
            tptr += dtdj;
            sptr += dsdj;
          }
          tptr += dtdk;
          sptr += dsdk;
        }
        return true;
      }
      clear() {
        for (let i = 0; i < this.data.length; i++) {
          this.data[i] = 0;
        }
      }
      destroy() {
        this.data = TEMP_UINT16ARRAY;
      }
      getStartPosition() {
        let idx = this.data.findIndex((data) => data !== 0);
        if (idx < 0) {
          return void 0;
        }
        const [strideX, strideY, strideZ] = this.stride;
        let x = 0;
        let y = 0;
        let z = 0;
        z = Math.floor(idx / strideZ);
        idx -= z * strideZ;
        y = Math.floor(idx / strideY);
        idx -= y * strideY;
        x = Math.floor(idx / strideX);
        return [x, y, z];
      }
    };
    exports.VoxelView = VoxelView2;
    function getBoxBoundary(voxels) {
      const start = [Infinity, Infinity, Infinity];
      const end = [-Infinity, -Infinity, -Infinity];
      (0, helper_1.traverseVoxels)(voxels, [0, 0, 0], voxels.getDimension(), (i, j, k, d) => {
        if (d) {
          gl_matrix_1.vec3.min(start, start, [i, j, k]);
          gl_matrix_1.vec3.max(end, end, [i, j, k]);
        }
      });
      return {
        start,
        end
      };
    }
    function allocVoxels(nx, ny, nz, dataStart, dataEnd) {
      let size = nx * ny * nz;
      let dataStride = void 0;
      if (dataStart && dataEnd) {
        const dnx = dataEnd[0] - dataStart[0];
        const dny = dataEnd[1] - dataStart[1];
        const dnz = dataEnd[2] - dataStart[2];
        size = dnx * dny * dnz;
        dataStride = [1, dnx, dnx * dny];
      }
      return new VoxelView2(new Uint16Array((0, pool_1.alloc)(size * 2)), [nx, ny, nz], [1, nx, nx * ny], 0, dataStart, dataEnd, dataStride);
    }
    function freeVoxels(voxels) {
      (0, pool_1.free)(voxels.data.buffer);
    }
    function cloneVoxels(voxels) {
      const result = allocVoxels(voxels.shape[0], voxels.shape[1], voxels.shape[2]);
      result.copy(voxels);
      return result;
    }
    function storeVoxels(voxels, ws, isEmpty) {
      const [nx, ny, nz] = voxels.shape;
      ws.writeInt32(nx);
      ws.writeInt32(ny);
      ws.writeInt32(nz);
      if (isEmpty) {
        return;
      }
      (0, rle_compress_1.compress)(voxels, ws);
    }
    function restoreVoxels(rs) {
      const nx = rs.readInt32();
      const ny = rs.readInt32();
      const nz = rs.readInt32();
      const isEmpty = rs.buffer.buffer.byteLength <= rs.offset;
      let voxels;
      if (isEmpty) {
        voxels = (0, helper_1.allocEmptyVoxels)(nx, ny, nz);
      } else {
        voxels = allocVoxels(nx, ny, nz);
        (0, rle_compress_1.decompress)(rs, voxels);
      }
      return {
        voxels,
        isEmpty
      };
    }
    function flipVoxels(voxels, axis, boundary) {
      const flipBoundary = boundary || getBoxBoundary(voxels);
      switch (axis) {
        case "X":
          flipX(voxels, flipBoundary);
          break;
        case "Y":
          flipY(voxels, flipBoundary);
          break;
        case "Z":
          flipZ(voxels, flipBoundary);
        default:
          break;
      }
    }
    function flipX(voxels, boundary) {
      const { start, end } = boundary;
      const spanX = start[0] + end[0];
      (0, helper_1.traverseVoxels)(voxels, start, [Math.floor(spanX / 2), end[1], end[2]], (i, j, k, d) => {
        const flipped = voxels.getVoxel(spanX - i, j, k);
        voxels.setVoxel(i, j, k, flipped);
        voxels.setVoxel(spanX - i, j, k, d);
      });
    }
    function flipY(voxels, boundary) {
      const { start, end } = boundary;
      const spanY = start[1] + end[1];
      (0, helper_1.traverseVoxels)(voxels, start, [end[0], Math.floor(spanY / 2), end[2]], (i, j, k, d) => {
        const flipped = voxels.getVoxel(i, spanY - j, k);
        voxels.setVoxel(i, j, k, flipped);
        voxels.setVoxel(i, spanY - j, k, d);
      });
    }
    function flipZ(voxels, boundary) {
      const { start, end } = boundary;
      const spanZ = start[2] + end[2];
      (0, helper_1.traverseVoxels)(voxels, start, [end[0], end[1], Math.floor(spanZ / 2)], (i, j, k, d) => {
        const flipped = voxels.getVoxel(i, j, spanZ - k);
        voxels.setVoxel(i, j, k, flipped);
        voxels.setVoxel(i, j, spanZ - k, d);
      });
    }
    function isEmptyVoxels(voxelView) {
      return voxelView.data.some((v) => v !== 0);
    }
  }
});

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/migrations/index.ts
var import_stream3 = __toESM(require_stream());

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/schema-v1.ts
var import_schema2 = __toESM(require_schema());

// ../dao3 max/box3-local-engine/packages/voxa-project/src/util.ts
var import_schema = __toESM(require_schema());
var Vec3Schema = new import_schema.MuVector(new import_schema.MuFloat32(), 3);
var Vec4Schema = new import_schema.MuVector(new import_schema.MuFloat32(), 4);
var Uint8Vec3Schema = new import_schema.MuVector(new import_schema.MuUint8(), 3);
var Uint16Vec3Schema = new import_schema.MuVector(new import_schema.MuUint16(), 3);
var Mat4Schema = new import_schema.MuVector(new import_schema.MuFloat32(), 16);
var Mat3Schema = new import_schema.MuVector(new import_schema.MuFloat32(), 9);
var TimeAccessorSchema = new import_schema.MuArray(new import_schema.MuFloat32(), Infinity);
var RotationAccessorSchema = new import_schema.MuArray(Vec4Schema, Infinity);
var TranslationAccessorSchema = new import_schema.MuArray(Vec3Schema, Infinity);
var AlphaAccessorSchema = new import_schema.MuArray(new import_schema.MuFloat32(), Infinity);
var OutputSchema = new import_schema.MuUnion({
  rotation: RotationAccessorSchema,
  translation: TranslationAccessorSchema,
  alpha: AlphaAccessorSchema,
  scale: TranslationAccessorSchema
});
var SamplerSchema = new import_schema.MuStruct({
  /**
   * 表示动画的时间节点
   * 对应gltf指向accessor索引值
   */
  input: TimeAccessorSchema,
  /**
   * 表示动画时间节点对应的translation/rotation/alpha
   * 对应gltf指向accessor的索引值
   */
  output: OutputSchema,
  /**
   * 补帧方式
   */
  interpolation: new import_schema.MuASCII("LINEAR" /* Linear */)
});

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/schema-v1.ts
var MeshSchema = new import_schema2.MuArray(new import_schema2.MuUint8(), Infinity);
var ModelDataV1Schema = new import_schema2.MuStruct({
  /**
   * 模型文件的物理碰撞框
   */
  bounds: Vec3Schema,
  /**
   * 模型文件mesh数据
   */
  meshes: new import_schema2.MuDictionary(MeshSchema, Infinity)
});

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/schema-v2.ts
var import_schema3 = __toESM(require_schema());
var ModelNodeSchema = new import_schema3.MuStruct({
  /**
   * 节点对应的模型索引值
   */
  mesh: new import_schema3.MuInt32(-1),
  /**
   * 节点的旋转量
   * 相对于父节点的值
   */
  rotation: Vec4Schema,
  /**
   * 节点的位移量
   * 相对于父节点的值
   */
  translation: Vec3Schema,
  /**
   * 节点的子节点们的索引值
   */
  children: new import_schema3.MuArray(new import_schema3.MuVarint(), Infinity),
  /**
   * 透明度，默认为1
   */
  alpha: new import_schema3.MuFloat32(1)
});
var ModelNodesSchema = new import_schema3.MuArray(ModelNodeSchema, Infinity);
var ModelDataV2Schema = new import_schema3.MuStruct({
  /**
   * 模型文件的版本号
   */
  version: new import_schema3.MuVarint(2),
  /**
   * 模型文件的物理碰撞框
   */
  bounds: Vec3Schema,
  /**
   * 模型文件的节点数据
   * 严格按照父节点 -> 子节点的顺序输出
   * 第一个元素为根节点，仅存在children字段
   */
  nodes: ModelNodesSchema,
  /**
   * 模型文件mesh数据
   */
  meshes: new import_schema3.MuArray(MeshSchema, Infinity)
});

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/schema-v3.ts
var import_schema4 = __toESM(require_schema2());
var import_schema5 = __toESM(require_schema());
var ModelDataV3Schema = new import_schema5.MuStruct({
  /**
   * 模型文件的版本号
   */
  version: new import_schema5.MuVarint(3),
  /**
   * 模型文件的物理碰撞框
   */
  bounds: Vec3Schema,
  /**
   * 模型文件的节点数据
   * 严格按照父节点 -> 子节点的顺序输出
   * 第一个元素为根节点，仅存在children字段
   */
  nodes: ModelNodesSchema,
  /**
   * 模型的贴图合集
   */
  texture: import_schema4.MeshTextureSchema,
  /**
   * 模型mesh数据
   */
  meshes: new import_schema5.MuArray(import_schema4.MeshDataSchema, Infinity)
});

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/schema-v4.ts
var import_schema6 = __toESM(require_schema2());
var import_schema7 = __toESM(require_schema());
var ModelDataV4Schema = new import_schema7.MuStruct({
  /**
   * 模型文件的版本号
   * 文件内自存，用于写入bytes中
   */
  version: new import_schema7.MuVarint(4),
  /**
   * 模型文件的节点数据
   * 严格按照父节点 -> 子节点的顺序输出
   * 第一个元素为根节点，仅存在children字段
   */
  nodes: ModelNodesSchema,
  /**
   * 模型的贴图合集
   */
  texture: import_schema6.MeshTextureSchema,
  /**
   * 模型mesh数据
   */
  meshes: new import_schema7.MuArray(import_schema6.MeshDataSchema, Infinity)
});

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/schema-v5.ts
var import_schema8 = __toESM(require_schema2());
var import_schema9 = __toESM(require_schema());
var ChannelSchema = new import_schema9.MuStruct({
  /**
   * 对应samplers的索引值
   */
  sampler: new import_schema9.MuVarint(),
  /**
   * 节点目标
   */
  target: new import_schema9.MuStruct({
    /**
     * 对应节点的索引值
     */
    node: new import_schema9.MuVarint(),
    /**
     * 对应节点变化的属性值
     */
    path: new import_schema9.MuASCII()
  })
});
var AnimationSchema = new import_schema9.MuStruct({
  /**
   * 动画ID
   */
  id: new import_schema9.MuASCII(),
  /**
   * 动画的名字，可输入中英文以及某些特殊符号
   */
  name: new import_schema9.MuUTF8(),
  channels: new import_schema9.MuArray(ChannelSchema, Infinity),
  samplers: new import_schema9.MuArray(SamplerSchema, Infinity)
});
var ModelDataV5Schema = new import_schema9.MuStruct({
  /**
   * 模型文件的版本号
   */
  version: new import_schema9.MuVarint(5),
  /**
   * 模型文件的节点数据
   * 严格按照父节点 -> 子节点的顺序输出
   * 第一个元素为根节点，仅存在children字段
   */
  nodes: ModelNodesSchema,
  /**
   * 模型的贴图合集
   */
  texture: import_schema8.MeshTextureSchema,
  /**
   * 模型mesh数据
   */
  meshes: new import_schema9.MuArray(import_schema8.MeshDataSchema, Infinity),
  /**
   * 模型动画数据
   */
  animations: new import_schema9.MuArray(AnimationSchema, Infinity)
});

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/schema-v6.ts
var import_schema10 = __toESM(require_schema2());
var import_schema11 = __toESM(require_schema());
var ChannelSchema2 = new import_schema11.MuStruct({
  /**
   * 对应samplers的索引值
   */
  sampler: new import_schema11.MuVarint(),
  /**
   * 节点目标
   */
  target: new import_schema11.MuStruct({
    /**
     * 对应节点的索引值
     */
    node: new import_schema11.MuVarint(),
    /**
     * 对应节点变化的属性值
     */
    path: new import_schema11.MuASCII()
  })
});
var AnimationSchema2 = new import_schema11.MuStruct({
  /**
   * 动画ID
   */
  id: new import_schema11.MuASCII(),
  /**
   * 动画的名字，可输入中英文以及某些特殊符号
   */
  name: new import_schema11.MuUTF8(),
  channels: new import_schema11.MuArray(ChannelSchema2, Infinity),
  samplers: new import_schema11.MuArray(SamplerSchema, Infinity)
});
var ModelNodeSchema2 = new import_schema11.MuStruct({
  /**
   * 节点对应的模型索引值
   */
  mesh: new import_schema11.MuInt32(-1),
  /**
   * 节点的旋转量
   * 相对于父节点的值
   */
  rotation: Vec4Schema,
  /**
   * 节点的位移量
   * 相对于父节点的值
   */
  translation: Vec3Schema,
  /**
   * 节点的缩放
   */
  scale: Vec3Schema,
  /**
   * 节点的子节点们的索引值
   */
  children: new import_schema11.MuArray(new import_schema11.MuVarint(), Infinity),
  /**
   * 透明度，默认为1
   */
  alpha: new import_schema11.MuFloat32(1)
});
var ModelNodesSchema2 = new import_schema11.MuArray(ModelNodeSchema2, Infinity);
var ModelDataV6Schema = new import_schema11.MuStruct({
  /**
   * 模型文件的版本号
   */
  version: new import_schema11.MuVarint(6),
  /**
   * 模型文件的节点数据
   * 严格按照父节点 -> 子节点的顺序输出
   * 第一个元素为根节点，仅存在children字段
   */
  nodes: ModelNodesSchema2,
  /**
   * 模型的贴图合集
   */
  texture: import_schema10.MeshTextureSchema,
  /**
   * 模型mesh数据
   */
  meshes: new import_schema11.MuArray(import_schema10.MeshDataSchema, Infinity),
  /**
   * 模型动画数据
   */
  animations: new import_schema11.MuArray(AnimationSchema2, Infinity)
});

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/schema-v7.ts
var import_schema12 = __toESM(require_schema2());
var import_schema13 = __toESM(require_schema());
var ChannelSchema3 = new import_schema13.MuStruct({
  /**
   * 对应samplers的索引值
   */
  sampler: new import_schema13.MuVarint(),
  /**
   * 节点目标
   */
  target: new import_schema13.MuStruct({
    /**
     * 对应节点的索引值
     */
    node: new import_schema13.MuVarint(),
    /**
     * 对应节点变化的属性值
     */
    path: new import_schema13.MuASCII()
  })
});
var AnimationSchema3 = new import_schema13.MuStruct({
  /**
   * 动画ID
   */
  id: new import_schema13.MuASCII(),
  /**
   * 动画的名字，可输入中英文以及某些特殊符号
   */
  name: new import_schema13.MuUTF8(),
  channels: new import_schema13.MuArray(ChannelSchema3, Infinity),
  samplers: new import_schema13.MuArray(SamplerSchema, Infinity)
});
var ModelNodeSchema3 = new import_schema13.MuStruct({
  /**
   * 节点对应的模型索引值
   */
  mesh: new import_schema13.MuInt32(-1),
  /**
   * 节点的旋转量
   * 相对于父节点的值
   */
  rotation: Vec4Schema,
  /**
   * 节点的位移量
   * 相对于父节点的值
   */
  translation: Vec3Schema,
  /**
   * 节点的缩放
   */
  scale: Vec3Schema,
  /**
   * 世界轴(父级)缩放矩阵数据
   */
  parentScaleMat3: Mat3Schema,
  /**
   * 节点的子节点们的索引值
   */
  children: new import_schema13.MuArray(new import_schema13.MuVarint(), Infinity),
  /**
   * 透明度，默认为1
   */
  alpha: new import_schema13.MuFloat32(1)
});
var ModelNodesSchema3 = new import_schema13.MuArray(ModelNodeSchema3, Infinity);
var ModelDataV7Schema = new import_schema13.MuStruct({
  /**
   * 模型文件的版本号
   */
  version: new import_schema13.MuVarint(7),
  /**
   * 模型文件的节点数据
   * 严格按照父节点 -> 子节点的顺序输出
   * 第一个元素为根节点，仅存在children字段
   */
  nodes: ModelNodesSchema3,
  /**
   * 模型的贴图合集
   */
  texture: import_schema12.MeshTextureSchema,
  /**
   * 模型mesh数据
   */
  meshes: new import_schema13.MuArray(import_schema12.MeshDataSchema, Infinity),
  /**
   * 模型动画数据
   */
  animations: new import_schema13.MuArray(AnimationSchema3, Infinity)
});

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/def.ts
var VOXA_MODEL_VERSION = 7;
var MODEL_SCHEMA = {
  1: ModelDataV1Schema,
  2: ModelDataV2Schema,
  3: ModelDataV3Schema,
  4: ModelDataV4Schema,
  5: ModelDataV5Schema,
  6: ModelDataV6Schema,
  7: ModelDataV7Schema
};

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/migrations/migrate-v1.ts
var import_stream = __toESM(require_stream());

// ../dao3 max/box3-local-engine/packages/voxa-project/src/fast-mesh-decoder.ts
var MAX_MATERIAL_COUNT = 256;
var RGB_TABLE = new Array(MAX_MATERIAL_COUNT);
var PBR_TABLE = new Array(MAX_MATERIAL_COUNT);
for (let i = 0; i < MAX_MATERIAL_COUNT; ++i) {
  RGB_TABLE[i] = PBR_TABLE[i] = 0;
}
var FACE_VERTS = 4;
var VERT_SIZE = 3;
var PTR_STEP = FACE_VERTS * VERT_SIZE;
function endianByteShift(x) {
  return x * 8 >>> 0;
}
var S0 = endianByteShift(0);
var S1 = endianByteShift(1);
var S2 = endianByteShift(2);
var S3 = endianByteShift(3);
var AO_TABLE = [
  0 << S3 >>> 0,
  153 << S3 >>> 0,
  204 << S3 >>> 0,
  255 << S3 >>> 0
];

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/migrations/migrate-v2.ts
var import_mesher = __toESM(require_build());

// ../dao3 max/box3-local-engine/internals/vb/src/index.ts
var import_stream2 = __toESM(require_stream());

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/migrations/migrate-v2.ts
var import_voxel = __toESM(require_voxel());

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/migrations/migrate-v5.ts
var IDENTITY_SCALE = Vec3Schema.fromJSON([1, 1, 1]);

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/migrations/migrate-v6.ts
var IDENTITY_SCALE_MAT3 = Mat3Schema.fromJSON([1, 0, 0, 0, 1, 0, 0, 0, 1]);

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/migrations/index.ts
function modelBytesToSchema(bytes) {
  try {
    const json = JSON.parse(Buffer.from(bytes).toString());
    if (json.meshes) {
      return {
        version: 1,
        schema: MODEL_SCHEMA[1].fromJSON(json)
      };
    }
  } catch (e) {
  }
  const stream = new import_stream3.MuReadStream(bytes);
  const version = stream.readVarint();
  if (!isValidModelVersion(version)) {
    console.error(`version: ${version} is invalid`);
    return;
  }
  const schema = MODEL_SCHEMA[version];
  return {
    version,
    schema: schema.patch(schema.identity, stream)
  };
}
function isValidModelVersion(version) {
  return version > 0 && version <= VOXA_MODEL_VERSION;
}

// ../dao3 max/box3-local-engine/packages/voxa-project/src/model/index.ts
function getModelMetaData(hash, bytes) {
  const metaData = getMetaDataByBytes(bytes);
  if (metaData) {
    return metaData;
  }
  const data = modelBytesToSchema(bytes);
  if (!data || !hasBounds(data.schema)) {
    return;
  }
  let [x, y, z] = data.schema.bounds;
  if (data.version === 1) {
    x++;
    y++;
    z++;
  }
  return {
    version: data.version,
    bounds: [x, y, z],
    dataHash: hash
  };
}
function hasBounds(data) {
  return !!data.bounds;
}
function getMetaDataByBytes(bytes) {
  try {
    const json = JSON.parse(Buffer.from(bytes).toString());
    if (json.version && json.bounds && json.dataHash) {
      return json;
    }
  } catch (e) {
  }
}

// tmp/model-decoder-entry.js
var import_build = __toESM(require_build(), 1);
var export_unpackMeshData = import_build.unpackMeshData;
var export_unpackTextureData = import_build.unpackTextureData;
export {
  getModelMetaData,
  modelBytesToSchema,
  export_unpackMeshData as unpackMeshData,
  export_unpackTextureData as unpackTextureData
};
