// Who the bot serves: members of the organisation that runs it, plus any guest
// the organisation has chosen to let in. Nobody else.
//
// Every turn resolves its sender and ensureUserSetup creates an LNbits account
// with Private and Allowance wallets for anyone it has not seen. An app
// installed "for everyone" also reaches the tenant's guests, so without a
// check each guest would get an LNbits account, and any failure on the turn
// an apology message. Fail closed:
//
// * a Teams member (userRole "user") of this bot's own tenant is served;
// * a guest, or a user from another tenant, is served only when listed in
//   ZAPLIE_GUEST_ALLOWLIST (empty by default);
// * an anonymous meeting participant is never served.
//
// ZAPLIE_GUEST_ALLOWLIST is comma-separated. Each entry is one of:
//   person@example.com   that person, by the email Teams reports
//   @example.com         everyone at that email domain
//   <Entra object id>    that person, by their id in this tenant
// Letting someone in is an app setting and a restart: no code change.

export const ALLOWED_USER_ROLE = 'user';

export interface TeamsMemberLike {
  userRole?: string;
  tenantId?: string;
  email?: string;
  userPrincipalName?: string;
  aadObjectId?: string;
}

export type MemberVerdict =
  | { allowed: true; via: 'member' | 'allowlist' }
  | {
      allowed: false;
      reason:
        | 'guest'
        | 'anonymous'
        | 'not_a_member'
        | 'other_tenant'
        | 'no_tenant_configured';
    };

const norm = (value: string | undefined): string =>
  (value ?? '').trim().toLowerCase();

export interface GuestAllowlist {
  emails: Set<string>;
  domains: Set<string>;
  ids: Set<string>;
}

export const parseGuestAllowlist = (
  raw: string | undefined = process.env.ZAPLIE_GUEST_ALLOWLIST,
): GuestAllowlist => {
  const list: GuestAllowlist = {
    emails: new Set(),
    domains: new Set(),
    ids: new Set(),
  };
  for (const entry of (raw ?? '').split(',').map(norm).filter(Boolean)) {
    if (entry.startsWith('@') && entry.length > 1) {
      list.domains.add(entry.slice(1));
    } else if (entry.includes('@')) {
      list.emails.add(entry);
    } else {
      list.ids.add(entry);
    }
  }
  return list;
};

const isAllowlisted = (
  member: TeamsMemberLike,
  allowlist: GuestAllowlist,
): boolean => {
  const email = norm(member.email);
  const domain = email.includes('@') ? email.split('@').pop()! : '';
  return (
    (email !== '' && allowlist.emails.has(email)) ||
    (domain !== '' && allowlist.domains.has(domain)) ||
    (norm(member.aadObjectId) !== '' &&
      allowlist.ids.has(norm(member.aadObjectId)))
  );
};

export const memberVerdict = (
  member: TeamsMemberLike | null | undefined,
  homeTenantId: string | undefined = process.env.AAD_APP_TENANT_ID,
  allowlist: GuestAllowlist = parseGuestAllowlist(),
): MemberVerdict => {
  const home = norm(homeTenantId);
  if (!home) {
    return { allowed: false, reason: 'no_tenant_configured' };
  }
  const role = norm(member?.userRole);
  if (role === 'anonymous' || !member) {
    return {
      allowed: false,
      reason: role === 'anonymous' ? 'anonymous' : 'not_a_member',
    };
  }
  if (role === ALLOWED_USER_ROLE && norm(member.tenantId) === home) {
    return { allowed: true, via: 'member' };
  }
  if (
    (role === 'guest' || role === ALLOWED_USER_ROLE) &&
    isAllowlisted(member, allowlist)
  ) {
    return { allowed: true, via: 'allowlist' };
  }
  if (role === 'guest') {
    return { allowed: false, reason: 'guest' };
  }
  if (role === ALLOWED_USER_ROLE) {
    return { allowed: false, reason: 'other_tenant' };
  }
  return { allowed: false, reason: 'not_a_member' };
};
