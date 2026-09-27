/** Presentation-only privacy: cswap's accounts and cached source data stay intact. */
export function privateSnapshot(snapshot, privacy) {
  if (!privacy || !snapshot) return snapshot;
  return {
    ...snapshot,
    accounts: snapshot.accounts.map((account) => ({
      ...account,
      email: null,
      alias: `Account ${account.number}`,
      organizationName: null,
    })),
  };
}

/** CLI errors may contain an email, account name, or local filesystem path. */
export function privateError(error, privacy) {
  return privacy && error ? 'Unable to read cswap usage. Turn off privacy mode to see error details.' : error;
}
