"""Fail only on node --test failures present in the candidate TAP log but not in its base log."""
import re
import sys


def summary(path):
    text = open(path, encoding='utf-8', errors='replace').read()
    failed = set(re.findall(r'^not ok \d+ - (.+)$', text, re.M))
    passed = re.search(r'^# pass (\d+)$', text, re.M)
    return failed, int(passed.group(1)) if passed else 0


base, cand = summary(sys.argv[1]), summary(sys.argv[2])
new = sorted(cand[0] - base[0])
fixed = sorted(base[0] - cand[0])
print('base: %d passed, %d failed; candidate: %d passed, %d failed' % (base[1], len(base[0]), cand[1], len(cand[0])))
for name in fixed:
    print('no longer failing:', name)
for name in new:
    print('NEW FAILURE:', name)
if cand[1] == 0:
    print('candidate suite did not run')
sys.exit(1 if new or cand[1] == 0 else 0)
