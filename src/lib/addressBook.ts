/**
 * Per-sender address book (#432).
 *
 * Each connected sender maintains their own saved list of approved
 * recipients, used to speed up stream creation and reduce entry errors.
 * An optional per-sender whitelist mode restricts stream recipients to
 * addresses present in the sender's book.
 *
 * Storage layout:
 *   - `sorostream_address_book_v2`  → Record<senderAddress, Contact[]>
 *   - `sorostream_address_book`     → legacy global list (migrated per-sender on first access)
 *   - `sorostream_recipient_whitelist_v1` → Record<senderAddress, boolean>
 *
 * All functions fall back to the legacy global list when called without
 * an owner, preserving backwards compatibility.
 */

export interface AddressBookContact {
  id: string;
  name: string;
  address: string;
}

const LEGACY_STORAGE_KEY = "sorostream_address_book";
const STORAGE_KEY = "sorostream_address_book_v2";
const WHITELIST_KEY = "sorostream_recipient_whitelist_v1";
const MAX_CONTACTS = 50;

export { MAX_CONTACTS };

type ContactStore = Record<string, AddressBookContact[]>;

/** Stellar public key guard — owners must be valid G… addresses. */
function isValidOwner(owner: string | undefined | null): owner is string {
  return typeof owner === "string" && /^G[A-Z2-7]{55}$/.test(owner);
}

function isValidAddress(address: unknown): address is string {
  return typeof address === "string" && /^G[A-Z2-7]{55}$/.test(address);
}

function sanitizeContacts(value: unknown): AddressBookContact[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c: unknown) =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as Record<string, unknown>).id === "string" &&
      typeof (c as Record<string, unknown>).name === "string" &&
      isValidAddress((c as Record<string, unknown>).address),
  ) as AddressBookContact[];
}

function readLegacyContacts(): AddressBookContact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeContacts(JSON.parse(raw));
  } catch {
    return [];
  }
}

function readStore(): ContactStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const store: ContactStore = {};
    for (const [owner, contacts] of Object.entries(parsed)) {
      if (isValidOwner(owner)) store[owner] = sanitizeContacts(contacts);
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: ContactStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage errors (e.g. private browsing quota)
  }
}

/**
 * Return the owner's contacts, seeding from the legacy global list on
 * first access so existing users keep their saved recipients.
 */
function getOwnerContacts(owner: string): AddressBookContact[] {
  const store = readStore();
  if (!Object.prototype.hasOwnProperty.call(store, owner)) {
    // One-time migration: copy the pre-whitelist global book to this sender.
    const legacy = readLegacyContacts();
    store[owner] = legacy;
    writeStore(store);
    return legacy;
  }
  return store[owner];
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getContacts(owner?: string): AddressBookContact[] {
  if (!isValidOwner(owner)) return readLegacyContacts();
  return [...getOwnerContacts(owner)];
}

/**
 * Look up a saved contact by its Stellar address (case-insensitive).
 * Useful for the create-stream quick-fill to show the stored alias
 * alongside a previously-saved recipient address.
 */
export function getContactByAddress(
  address: string,
  owner?: string,
): AddressBookContact | undefined {
  if (!isValidAddress(address)) return undefined;
  const contacts = getContacts(owner);
  const lower = address.toLowerCase();
  return contacts.find((c) => c.address.toLowerCase() === lower);
}

export function saveContact(contact: AddressBookContact, owner?: string): boolean {
  if (owner !== undefined && !isValidOwner(owner)) {
    return false;
  }
  if (!isValidOwner(owner)) {
    // Legacy global behaviour
    const contacts = readLegacyContacts();
    if (contacts.length >= MAX_CONTACTS) return false;
    if (contacts.some((c) => c.id === contact.id)) return false;
    contacts.push(contact);
    try {
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(contacts));
      return true;
    } catch {
      return false;
    }
  }

  const store = readStore();
  const contacts = Object.prototype.hasOwnProperty.call(store, owner)
    ? store[owner]
    : [];
  if (contacts.length >= MAX_CONTACTS) return false;
  if (contacts.some((c) => c.id === contact.id)) return false;
  store[owner] = [...contacts, contact];
  writeStore(store);
  return true;
}

export function updateContact(
  id: string,
  updates: Partial<Pick<AddressBookContact, "name" | "address">>,
  owner?: string,
): boolean {
  if (!isValidOwner(owner)) {
    const contacts = readLegacyContacts();
    const idx = contacts.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    contacts[idx] = { ...contacts[idx], ...updates };
    try {
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(contacts));
      return true;
    } catch {
      return false;
    }
  }

  const contacts = getOwnerContacts(owner);
  const idx = contacts.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  const store = readStore();
  store[owner] = contacts.map((c, i) => (i === idx ? { ...c, ...updates } : c));
  writeStore(store);
  return true;
}

export function deleteContact(id: string, owner?: string): void {
  if (!isValidOwner(owner)) {
    const contacts = readLegacyContacts().filter((c) => c.id !== id);
    try {
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(contacts));
    } catch {
      // ignore
    }
    return;
  }

  const store = readStore();
  store[owner] = getOwnerContacts(owner).filter((c) => c.id !== id);
  writeStore(store);
}

// ── Recipient whitelist (#432) ───────────────────────────────────────────────

/** Whether the given recipient is approved for streams from this sender. */
export function isRecipientApproved(recipient: string, owner?: string): boolean {
  if (!isValidOwner(owner)) return true; // no known sender → cannot enforce
  if (!isWhitelistEnforced(owner)) return true;
  return getOwnerContacts(owner).some(
    (c) => c.address.toLowerCase() === recipient.toLowerCase(),
  );
}

export function isWhitelistEnforced(owner?: string): boolean {
  if (!isValidOwner(owner) || typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(WHITELIST_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return typeof parsed?.[owner] === "boolean" ? parsed[owner] : false;
  } catch {
    return false;
  }
}

export function setWhitelistEnforced(enabled: boolean, owner?: string): void {
  if (!isValidOwner(owner) || typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(WHITELIST_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[owner] = enabled;
    localStorage.setItem(WHITELIST_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}
