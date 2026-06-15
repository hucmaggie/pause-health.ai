#!/usr/bin/env bash
#
# Deploy the version-controlled Pause Agentforce intake/provider metadata
# (the prechat-handoff subset tracked in this repo) to a Salesforce org.
#
# Usage:
#   ./deploy.sh [target-org-alias]      # default alias: trailsignup
#
# Deploys exactly the members listed in manifest/package.xml:
#   NamedCredential   Pause_Provider_API
#   CustomField       MessagingSession.Pause_Patient_Insurance__c
#   CustomField       MessagingSession.Pause_Patient_Zip__c
#   Flow              Pause_Intake_Prechat_Router
#   MessagingChannel  Messaging_for_In_App_Web
#   PermissionSet     Pause_Health_Intake_Prechat_Dossier
#
# NOTE: the permission set grants FLS on the full ~22-field dossier, but only
# Pause_Patient_Zip__c and Pause_Patient_Insurance__c are tracked in this repo
# today. That deploys cleanly to an org where the other dossier fields already
# exist (e.g. trailsignup). For a BRAND-NEW org, run ./retrieve.sh first to pull
# the remaining fields + the Agent (Bot/GenAiPlannerBundle), or the permission
# set deploy will fail on the undefined field references. See README.md.
set -euo pipefail

ORG="${1:-trailsignup}"
cd "$(dirname "$0")"

echo "Deploying Pause prechat-handoff metadata → org '${ORG}' …"
sf project deploy start \
  --manifest manifest/package.xml \
  --target-org "${ORG}"
