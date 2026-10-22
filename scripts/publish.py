"""Publish prepared tags and original assets with an authenticated GitHub CLI.

Usage: python3 scripts/publish.py OWNER/REPOSITORY
The repository must already exist. Never overwrite release assets or force push.
"""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
repository = sys.argv[1] if len(sys.argv) == 2 else ''
if len(repository.split('/')) != 2 or any(not part or part.startswith('-') for part in repository.split('/')):
    raise SystemExit('Usage: python3 scripts/publish.py OWNER/REPOSITORY')

def run(*args):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, capture_output=True).stdout

run('gh', 'auth', 'status', '--hostname', 'github.com')
metadata = json.loads(run('gh', 'repo', 'view', repository, '--json', 'nameWithOwner,url'))
if metadata['nameWithOwner'].lower() != repository.lower():
    raise SystemExit('Unexpected repository identity.')
run('git', 'push', 'https://github.com/' + repository + '.git', 'main', '--tags')
existing = json.loads(run('gh', 'api', '--paginate', '--slurp', 'repos/' + repository + '/releases'))
existing_tags = {release['tag_name'] for page in existing for release in page}
for release in json.loads((ROOT / 'releases/index.json').read_text()):
    tag = release['tag']
    if tag in existing_tags:
        print('Already published; verify manually without replacing:', tag)
        continue
    run('gh', 'release', 'create', tag, *release['assets'], '--repo', repository,
        '--verify-tag', '--prerelease', '--title', 'CVAT Track Refiner ' + tag,
        '--notes-file', 'releases/' + tag + '.md')
    print('Published', tag)
print(metadata['url'])
