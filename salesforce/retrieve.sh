#!/usr/bin/env bash
#
# Retrieve the FULL Pause Agentforce source-of-truth from a Salesforce org into
# this project, so the repo (not the org) becomes the canonical source.
#
# Usage:
#   ./retrieve.sh [target-org-alias]    # default alias: trailsignup
#
# Pulls everything in manifest/package-complete.xml — the deployable subset PLUS
# the pieces that are still org-managed and not yet committed:
#   - the remaining ~20 MessagingSession.Pause_*__c dossier fields
#   - the Agent (Bot + GenAiPlannerBundle + GenAiPlugin/GenAiFunction topics)
#   - the ExternalServiceRegistration (PauseProviderDirectory)
#
# After retrieving, review the diff, strip any XML comments from deployable
# files (see README "comment-free" rule), and commit. This is the one command
# that closes the Phase 18b gap on a network that can reach *.my.salesforce.com.
set -euo pipefail

ORG="${1:-trailsignup}"
cd "$(dirname "$0")"

echo "Retrieving full Pause Agentforce metadata ← org '${ORG}' …"
sf project retrieve start \
  --manifest manifest/package-complete.xml \
  --target-org "${ORG}"
