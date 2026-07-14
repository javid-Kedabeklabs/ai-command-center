export function collaborationContractPack({ baseSha, path, sha256, scenarioIds, maxChangedFiles, planningCodexSeconds = 3_600 }) {
  return {
    reviewedBaseSha: baseSha,
    acceptanceTestCommitSha: baseSha,
    contractFiles: [{ path, sha256 }],
    scenarioIds,
    maxChangedFiles,
    planningCodexSeconds,
    stopConditions: [
      'Stop outside the leased paths.',
      'Stop when a frozen authority or acceptance input changes.',
      'Stop rather than weaken, skip, retry, or redefine acceptance tests.',
    ],
    authoritySet: {
      productBehavior: { disposition: 'bound', paths: [path] },
      securityAndCapabilities: { disposition: 'not-applicable-and-forbidden', paths: [] },
      persistenceSchema: { disposition: 'not-applicable-and-forbidden', paths: [] },
      semanticPort: { disposition: 'not-applicable-and-forbidden', paths: [] },
      wireApi: { disposition: 'not-applicable-and-forbidden', paths: [] },
      designAndCopy: { disposition: 'not-applicable-and-forbidden', paths: [] },
      acceptanceTests: { disposition: 'bound', paths: [path] },
    },
    acceptanceSet: {
      tests: scenarioIds.map(id => ({ id, path, sha256 })),
      environment: { locale: 'en-US', timezone: 'UTC', clockSeed: 'fixed', dataSeed: 'fixture-v1' },
    },
  }
}
