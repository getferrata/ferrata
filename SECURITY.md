# Security

Ferrata reads other people's material and holds the provider key that pays for
generation, so a vulnerability here has real consequences for whoever is running
it. Please report privately, not in a public issue.

## Reporting

Open a private advisory:
https://github.com/getferrata/ferrata/security/advisories/new

Useful in a report: what an attacker would need (an account, a link the operator
opens, nothing at all), what they get, and the smallest set of steps that shows
it. A proof of concept is welcome and never required.

You will get an answer. If the report is valid, the fix and the release that
carries it are yours to see before anyone else, and you are credited unless you
would rather not be.

Please do not include real keys, tokens or hostnames from any install, including
your own.

## What is in scope

The application in this repository: the API routes, authentication and roles, the
job pipeline, the material ingestion path (files, links, local repositories), the
export and import of course packages, and the data protection gate.

Particularly interesting, because they are where a mistake would be quiet:

- Reading or writing a course you were not given.
- Spending on the install's key without being allowed to.
- Getting material out of a course through an export or an import.
- Reaching an internal address through a pasted link.
- Making the model treat imported material as instructions.

## What is out of scope

- Anything requiring an attacker who already controls the server or the database
  file. Encryption at rest protects a copy that leaves the machine; it cannot
  protect against someone who is already inside.
- The provider you point Ferrata at. Their handling of your requests is between
  you and them.
- Detection completeness of the data protection gate. It is rule based, so it
  can miss a format nobody has written a rule for. A missed secret is a gap
  worth reporting as an ordinary issue, not a vulnerability; a way to make it
  skip a value it does know is a vulnerability.
- Denial of service that needs an authenticated author, who can already spend
  the key by using the product normally.

## Supported versions

The latest release. Ferrata is small and self hosted: the fix ships as a new
release and updating is a pull and a restart.
