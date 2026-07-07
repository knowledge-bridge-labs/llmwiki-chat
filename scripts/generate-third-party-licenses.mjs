import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mode = process.argv[2] ?? 'production';
const outputPath = process.argv[3] ?? 'THIRD_PARTY_LICENSES.md';
const checkOnly = process.argv.includes('--check');

const packageJson = readJson('package.json');
const lock = readJson('package-lock.json');
const packages = lock.packages ?? {};

if (lock.lockfileVersion < 2 || !packages['']) {
  throw new Error('package-lock.json must be npm lockfile v2+ with packages metadata');
}

const rootDependencyNames = selectRootDependencyNames(mode);
const selectedPaths = new Set();
const missingDependencies = [];

for (const dependencyName of rootDependencyNames) {
  const dependencyPath = resolveDependency('', dependencyName);
  if (!dependencyPath) {
    missingDependencies.push(`<root> -> ${dependencyName}`);
    continue;
  }
  collect(dependencyPath);
}

const entries = [...selectedPaths]
  .map((packagePath) => packageEntry(packagePath))
  .sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    const byVersion = left.version.localeCompare(right.version);
    if (byVersion !== 0) return byVersion;
    return left.packagePath.localeCompare(right.packagePath);
  });

const dedupedEntries = [];
const seenPackages = new Set();
for (const entry of entries) {
  const key = `${entry.name}@${entry.version}`;
  if (seenPackages.has(key)) continue;
  seenPackages.add(key);
  dedupedEntries.push(entry);
}

const content = renderMarkdown(dedupedEntries);
const resolvedOutput = path.resolve(root, outputPath);

if (checkOnly) {
  const existing = fs.existsSync(resolvedOutput) ? fs.readFileSync(resolvedOutput, 'utf8') : '';
  if (normalizeNewlines(existing) !== normalizeNewlines(content)) {
    console.error(`${outputPath} is out of date. Run npm run licenses:generate.`);
    process.exit(1);
  }
  console.log(`${outputPath} is up to date`);
} else {
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, content);
  console.log(`wrote ${outputPath}`);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function selectRootDependencyNames(selectedMode) {
  if (selectedMode === 'production') {
    return Object.keys(packageJson.dependencies ?? {}).sort();
  }
  if (selectedMode === 'all') {
    return [
      ...new Set([
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.devDependencies ?? {})
      ])
    ].sort();
  }
  throw new Error(`unsupported mode: ${selectedMode}`);
}

function collect(packagePath) {
  if (selectedPaths.has(packagePath)) return;
  const metadata = packages[packagePath];
  if (!metadata) return;

  selectedPaths.add(packagePath);

  for (const dependencyName of Object.keys(metadata.dependencies ?? {}).sort()) {
    const dependencyPath = resolveDependency(packagePath, dependencyName);
    if (!dependencyPath) {
      missingDependencies.push(`${packagePath} -> ${dependencyName}`);
      continue;
    }
    collect(dependencyPath);
  }

}

function resolveDependency(fromPackagePath, dependencyName) {
  let current = fromPackagePath;
  while (current) {
    const candidate = `${current}/node_modules/${dependencyName}`;
    if (packages[candidate] && hasInstalledPackage(candidate)) return candidate;
    current = parentPackagePath(current);
  }

  const rootCandidate = `node_modules/${dependencyName}`;
  return packages[rootCandidate] && hasInstalledPackage(rootCandidate) ? rootCandidate : null;
}

function hasInstalledPackage(packagePath) {
  return fs.existsSync(path.join(root, packagePath, 'package.json'));
}

function parentPackagePath(packagePath) {
  const marker = '/node_modules/';
  const markerIndex = packagePath.lastIndexOf(marker);
  if (markerIndex === -1) return '';
  return packagePath.slice(0, markerIndex);
}

function packageEntry(packagePath) {
  const directory = path.join(root, packagePath);
  const installedPackageJson = readInstalledPackageJson(directory);
  const lockMetadata = packages[packagePath] ?? {};
  const name = installedPackageJson.name ?? packageNameFromPath(packagePath);
  const version = installedPackageJson.version ?? lockMetadata.version ?? 'unknown';
  const license = normalizeLicense(installedPackageJson.license ?? lockMetadata.license);
  const repository = normalizeRepository(installedPackageJson.repository);
  const homepage = installedPackageJson.homepage ?? '';
  const noticeFiles = findNoticeFiles(directory);

  return {
    packagePath,
    name,
    version,
    license,
    repository,
    homepage,
    noticeFiles
  };
}

function readInstalledPackageJson(directory) {
  const file = path.join(directory, 'package.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function packageNameFromPath(packagePath) {
  const marker = 'node_modules/';
  const markerIndex = packagePath.lastIndexOf(marker);
  return markerIndex === -1 ? packagePath : packagePath.slice(markerIndex + marker.length);
}

function normalizeLicense(value) {
  if (!value) return 'NOASSERTION';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(normalizeLicense).join(' OR ');
  if (typeof value === 'object' && value.type) return value.type;
  return JSON.stringify(value);
}

function normalizeRepository(repository) {
  if (!repository) return '';
  if (typeof repository === 'string') return repository;
  return repository.url ?? '';
}

function findNoticeFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => /^(licen[cs]e|copying|notice|copyright)(\..*)?$/i.test(entry.name))
    .map((entry) => {
      const file = path.join(directory, entry.name);
      return {
        name: entry.name,
        text: fs.readFileSync(file, 'utf8').trimEnd()
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function renderMarkdown(packageEntries) {
  const lines = [
    '# Third-Party License Texts',
    '',
    '<!-- Generated by scripts/generate-third-party-licenses.mjs. Do not edit by hand. -->',
    '',
    `Package: ${packageJson.name}@${packageJson.version}`,
    `Mode: ${mode}`,
    `Generated from: package-lock.json`,
    '',
    'This file records package metadata for the selected dependency graph and',
    'retains top-level license, copyright, notice, and attribution files when',
    'they are present in installed npm package directories.',
    '',
    '## Dependency Summary',
    '',
    '| Package | Version | Declared license |',
    '| --- | --- | --- |'
  ];

  for (const entry of packageEntries) {
    lines.push(`| \`${entry.name}\` | \`${entry.version}\` | ${escapeTable(entry.license)} |`);
  }

  if (missingDependencies.length > 0) {
    lines.push('', '## Missing Dependency Paths', '');
    for (const dependency of missingDependencies) {
      lines.push(`- ${dependency}`);
    }
  }

  lines.push('', '## Retained License Texts', '');

  for (const entry of packageEntries) {
    lines.push(`### ${entry.name}@${entry.version}`, '');
    lines.push(`- Declared license: ${entry.license}`);
    lines.push(`- Installed path: \`${entry.packagePath}\``);
    if (entry.repository) lines.push(`- Repository: ${entry.repository}`);
    if (entry.homepage) lines.push(`- Homepage: ${entry.homepage}`);

    if (entry.noticeFiles.length === 0) {
      lines.push(
        '',
        'No top-level license, notice, copying, or copyright file was found in the installed package.'
      );
      lines.push('');
      continue;
    }

    for (const noticeFile of entry.noticeFiles) {
      lines.push('', `#### ${noticeFile.name}`, '', '```text');
      lines.push(noticeFile.text);
      lines.push('```', '');
    }
  }

  return `${lines.join('\n')}\n`;
}

function escapeTable(value) {
  return String(value).replaceAll('|', '\\|');
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, '\n');
}
