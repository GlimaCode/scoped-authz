# Contributing

This is a [GlimaCode](https://glimacode.com) project — a two-developer studio.
This guide documents how we work, so the code stays consistent no matter which
of us touches it.

## Who maintains this

- [Ali Ahmadi](https://github.com/aliahmadi1382)
- [Mostafa Taghipour](https://github.com/MoStafaMTP)

External contributions are welcome as issues and pull requests, though we may
be slow to review — this is a working studio, not a community project.

## Commit identity

Each developer commits under their own GitHub identity, using a `noreply`
address so personal email never lands in public history:

```bash
git config --global user.name "Your Name"
git config --global user.email "<id>+<username>@users.noreply.github.com"
```

Your `<id>+<username>` address is listed at
[github.com/settings/emails](https://github.com/settings/emails).

## Branches

- `main` is always deployable.
- Work on a branch, open a pull request, let CI run.

## Before you push

```bash
npm test
```

`npm test` type-checks and runs the suite. Both must be clean.

## The bar for a change here

This library is small because it is load-bearing. Two rules follow from that:

**A new behaviour arrives with a test that fails without it.** Not a test that
exercises it — a test that goes red if you delete the change.

**An invariant arrives with proof that its test catches a violation.** Break it
on purpose, watch the right test fail, put it back. A suite that has never been
seen to fail is a claim, not evidence. The three mutations we ran are in the
README; add yours to that table.

## Comments

Comments here explain *why*, and especially why not the obvious alternative.
The code already says what it does. If a decision cost an argument or a bug,
that argument belongs next to the line it produced.
