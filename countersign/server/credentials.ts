import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CredentialDeviceType, WebAuthnCredential } from "@simplewebauthn/server";

export interface SavedCredential extends WebAuthnCredential {
  credentialDeviceType: CredentialDeviceType;
  credentialBackedUp: boolean;
}

type StoredCredential = Omit<SavedCredential, "publicKey"> & { publicKey: string };
type CredentialFile = Record<string, StoredCredential[]>;

// Only public keys and authenticator metadata are persisted, never private keys.
// Synchronous read-modify-rename keeps concurrent requests in this demo process
// from overwriting one another, and readers never see a partial JSON file.
export class CredentialStore {
  constructor(readonly path = resolve(process.cwd(), "data/credentials.json")) {}

  private read(): CredentialFile {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as CredentialFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private write(data: CredentialFile): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
  }

  forUser(userId: string): SavedCredential[] {
    return (this.read()[userId] ?? []).map((credential) => ({
      ...credential,
      publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
    }));
  }

  add(userId: string, credential: SavedCredential): void {
    const data = this.read();
    if (Object.values(data).some((items) => items.some((item) => item.id === credential.id))) {
      throw new Error("Credential is already registered.");
    }
    data[userId] ??= [];
    data[userId].push({
      ...credential,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    });
    this.write(data);
  }

  updateCounter(userId: string, credentialId: string, counter: number): string {
    const data = this.read();
    const credential = data[userId]?.find((item) => item.id === credentialId);
    if (!credential) throw new Error("Registered credential disappeared.");
    const warning = credential.counter > 0 && counter <= credential.counter
      ? `Authenticator counter did not increase (${credential.counter} -> ${counter}).`
      : "";
    credential.counter = Math.max(credential.counter, counter);
    this.write(data);
    return warning;
  }
}
