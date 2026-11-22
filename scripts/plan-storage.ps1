param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z]{2}(-[a-z0-9]+)+-\d+$')]
    [string]$Region,
    [ValidatePattern('^[A-Za-z][A-Za-z0-9-]{0,127}$')]
    [string]$StackName = 'harness-law-storage',
    [ValidateSet('development', 'staging', 'production')]
    [string]$Environment = 'production',
    [ValidatePattern('^$|[A-Za-z0-9_+=,.@-]{1,64}$')]
    [string]$ApplicationRoleName = '',
    [string]$Profile = '',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'AWS CLI is required. Authenticate with a deployment identity before running this script.'
}

$templatePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../infra/harness-storage.yaml'))
if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
    throw 'The Harness Law storage template is missing.'
}

$awsArguments = @(
    'cloudformation', 'deploy',
    '--template-file', $templatePath,
    '--stack-name', $StackName,
    '--region', $Region,
    '--capabilities', 'CAPABILITY_IAM',
    '--no-fail-on-empty-changeset',
    '--parameter-overrides',
    "Environment=$Environment",
    "ApplicationRoleName=$ApplicationRoleName"
)
if ($Profile) { $awsArguments += @('--profile', $Profile) }
if (-not $Apply) { $awsArguments += '--no-execute-changeset' }

# No secret is read or written. Default mode creates a reviewable change set only.
& aws @awsArguments
if ($LASTEXITCODE -ne 0) { throw 'CloudFormation did not complete the requested operation.' }

if ($Apply) {
    Write-Output 'Storage stack deployment completed. Read the stack outputs for the bucket, region and policy ARN.'
} else {
    Write-Output 'Review the change set in CloudFormation. Re-run with -Apply only when ready to create or update the resources.'
}
