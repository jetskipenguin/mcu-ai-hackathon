// Test-only software authenticator. Production code never imports this module.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { SavedCredential } from "../credentials.js";
import { RP } from "../webauthn.js";

export function authenticator() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  const idBytes = randomBytes(32);
  const id = idBytes.toString("base64url");
  const publicKey = isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2], [3, -7], [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
    [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
  ]));
  const credential: SavedCredential = {
    id, publicKey, counter: 0, transports: ["internal"],
    credentialDeviceType: "singleDevice", credentialBackedUp: false,
  };

  function authData(flags: number, counter: number, rpID: string) {
    const data = Buffer.alloc(37);
    createHash("sha256").update(rpID).digest().copy(data);
    data[32] = flags;
    data.writeUInt32BE(counter, 33);
    return data;
  }

  return {
    credential,
    assertion(challenge: string, options: {
      flags?: number; counter?: number; origin?: string; rpID?: string; user?: string;
    } = {}): AuthenticationResponseJSON {
      const clientData = Buffer.from(JSON.stringify({
        type: "webauthn.get", challenge, origin: options.origin ?? RP.origin, crossOrigin: false,
      }));
      const data = authData(options.flags ?? 0x05, options.counter ?? 1, options.rpID ?? RP.rpID);
      const signature = sign("sha256", Buffer.concat([
        data, createHash("sha256").update(clientData).digest(),
      ]), pair.privateKey);
      return {
        id, rawId: id, type: "public-key", clientExtensionResults: {},
        authenticatorAttachment: "platform",
        response: {
          clientDataJSON: clientData.toString("base64url"),
          authenticatorData: data.toString("base64url"),
          signature: signature.toString("base64url"),
          userHandle: Buffer.from(options.user ?? "stu-0011").toString("base64url"),
        },
      };
    },
    registration(challenge: string, options: { flags?: number; origin?: string; rpID?: string } = {}): RegistrationResponseJSON {
      const clientData = Buffer.from(JSON.stringify({
        type: "webauthn.create", challenge, origin: options.origin ?? RP.origin, crossOrigin: false,
      }));
      const length = Buffer.alloc(2);
      length.writeUInt16BE(idBytes.length);
      const data = Buffer.concat([
        authData(options.flags ?? 0x45, 0, options.rpID ?? RP.rpID),
        Buffer.alloc(16), length, idBytes, publicKey,
      ]);
      const attestationObject = isoCBOR.encode(new Map<string, string | Map<string, string> | Uint8Array>([
        ["fmt", "none"], ["attStmt", new Map()], ["authData", new Uint8Array(data)],
      ]));
      return {
        id, rawId: id, type: "public-key", clientExtensionResults: {},
        authenticatorAttachment: "platform",
        response: {
          clientDataJSON: clientData.toString("base64url"),
          attestationObject: Buffer.from(attestationObject).toString("base64url"),
          transports: ["internal"],
        },
      };
    },
  };
}
