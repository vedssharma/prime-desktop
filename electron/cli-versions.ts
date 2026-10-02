/**
 * Prime Agent CLI versions whose owned-RPC boundary has been verified (docs/owned-rpc-design.md).
 * To support a new release: run `npm run test:real-owned -- /path/to/prime-agent` against it, review
 * the RPC/owner-isolation source as the design doc describes, then add the version here.
 * Never add a version that has not passed that probe.
 */
export const VERIFIED_OWNED_VERSIONS: readonly string[] = ['0.9.6'];

/** Every standalone semantic version in `prime-agent --version` output (stdout and stderr). */
export function parseCliVersions(output: string): string[] {
  return [...output.matchAll(/(?:^|[\s(v])(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=$|[\s),])/gm)].map(match => match[1]);
}

/** The verified version in the output if there is one, otherwise the first version reported. */
export function parseCliVersion(output: string): string | undefined {
  const versions = parseCliVersions(output);
  return versions.find(isVerifiedOwnedVersion) ?? versions[0];
}

export function isVerifiedOwnedVersion(version: string | undefined): boolean {
  return !!version && VERIFIED_OWNED_VERSIONS.includes(version);
}

/** Human-readable list for messages, e.g. "0.9.6" or "0.9.6 or 0.9.7". */
export function verifiedVersionsText(): string {
  const versions = [...VERIFIED_OWNED_VERSIONS];
  return versions.length > 1 ? `${versions.slice(0, -1).join(', ')} or ${versions.at(-1)}` : versions[0];
}
