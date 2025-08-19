// -----------------------------
// Core deployment parameters
// -----------------------------
@description('Azure region for resources')
@allowed(['centralus','westus2','eastus2','westeurope','eastasia'])
param location string = 'eastasia'

@description('Short base name, lowercase/hyphen safe (e.g. drone)')
param baseName string = 'drone'

@description('Environment (dev|stg|prod)')
@allowed(['dev','stg','prod'])
param environment string = 'dev'

@description('Container image tag (must exist in ACR)')
param imageTag string = 'latest'

@description('Optional extra short suffix to differentiate revisions when reusing same imageTag (<=6 chars recommended)')
param revisionExtra string = ''

@description('vCPU cores for container (int)')
param containerCpu int = 1

@description('Memory for container (Gi). Valid combos with CPU: 0.25->0.5Gi, 0.5->1Gi, 0.75->1.5Gi, 1->2Gi, 1.25->2.5Gi, 1.5->3Gi, 1.75->3.5Gi, 2->4Gi')
param containerMemory string = '2Gi'

@description('Minimum replicas')
param minReplicas int = 1

@description('Maximum replicas')
param maxReplicas int = 3

@description('ACR SKU (Basic/Standard/Premium)')
param acrSku string = 'Basic'

@description('Container exposed port')
param apiTargetPort int = 8080

@description('Cosmos DB database name')
param cosmosDatabaseName string = 'DeepResearch'

@description('Allow anonymous access to API (true = allow, false = require auth/api key)')
param allowAnonymous bool = true

@description('Optional Key Vault secret name containing API key (API key auth). Leave empty to skip.')
param apiKeySecretName string = ''

@description('Optional specific Key Vault secret version for API key (blank uses latest).')
param apiKeySecretVersion string = ''

// -----------------------------
// Static Web App parameters
// -----------------------------
@description('Deploy Static Web App for frontend (true/false)')
param deploySwa bool = false

@description('GitHub repository URL for SWA')
param githubRepoUrl string = ''

@description('GitHub branch for SWA deployment')
param githubBranch string = 'main'

@description('Whether to create RBAC role assignments inside the template (can hang on TokenException). Default false; run manually or enable when stable.')
param enableRoleAssignments bool = false

// -----------------------------
// Derived naming (keep deterministic & short)
// -----------------------------
var namePrefix = '${baseName}-${environment}'
var acrName = toLower(replace('${namePrefix}acr','-',''))
var uamiName = '${namePrefix}-uami'
var kvName = '${namePrefix}-kv'
var cosmosAccountName = toLower(replace('${namePrefix}cdb','-',''))
var logName = '${namePrefix}-law'
var aiName = '${namePrefix}-ai'
var caeName = '${namePrefix}-cae'
var appName = '${namePrefix}-api'
// Derive revision suffix (lowercase, max 20, remove invalid chars)
var baseRev = toLower(replace(replace(imageTag, '_', '-'), '.', '-'))
var composedRev = revisionExtra == '' ? baseRev : '${baseRev}-${toLower(revisionExtra)}'
var revisionSuffix = length(composedRev) > 20 ? substring(composedRev, 0, 20) : composedRev

module identity 'modules/identity.bicep' = {
  name: 'identity'
  params: { name: uamiName, location: location }
}

module logging 'modules/log.bicep' = {
  name: 'logging'
  params: { location: location, logName: logName, aiName: aiName }
}

module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: { location: location, name: kvName, tenantId: tenant().tenantId }
}

module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: { location: location, accountName: cosmosAccountName, dbName: cosmosDatabaseName }
}

module acr 'modules/acr.bicep' = {
  name: 'acr'
  params: { location: location, name: acrName, sku: acrSku }
}

module cae 'modules/containerenv.bicep' = {
  name: 'containerenv'
  params: { location: location, name: caeName, logAnalyticsWorkspaceId: logging.outputs.workspaceId }
}

module app 'modules/containerapp.bicep' = {
  name: 'containerapp'
  params: {
    location: location
    name: appName
    envName: caeName
    image: '${acr.outputs.loginServer}/${appName}:${imageTag}'
    targetPort: apiTargetPort
    cpu: containerCpu
    memory: containerMemory
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    uamiResourceId: identity.outputs.resourceId
  uamiClientId: identity.outputs.clientId
    acrServer: acr.outputs.loginServer
    cosmosAccountUri: cosmos.outputs.accountUri
    cosmosDbName: cosmosDatabaseName
    keyVaultName: kvName
  allowAnonymousParam: allowAnonymous
  apiKeySecretName: apiKeySecretName
  apiKeySecretVersion: apiKeySecretVersion
  revisionSuffix: revisionSuffix
  }
  // Explicit dependsOn only for env creation; others referenced via params implicitly create dependency
  dependsOn: [cae]
}

// -----------------------------
// Static Web App (optional)
// -----------------------------
module swa 'modules/swa.bicep' = if (deploySwa) {
  name: 'swa-deploy'
  params: {
    swaName: '${baseName}-${environment}-swa'
    location: 'West US 2' // SWA は限られたリージョンのみサポート
    repositoryUrl: githubRepoUrl
    branch: githubBranch
    appLocation: '/swa-chat-ui'
    outputLocation: 'dist'
    tags: {}
  }
}

module roles 'modules/roles.bicep' = if (enableRoleAssignments) {
  name: 'roleAssignments'
  params: {
    principalId: identity.outputs.principalId
    acrId: acr.outputs.resourceId
    cosmosId: cosmos.outputs.accountId
    keyVaultId: keyvault.outputs.vaultId
  }
}

// -----------------------------
// Outputs
// -----------------------------
@description('Public FQDN for the Container App')
output containerAppFqdn string = app.outputs.fqdn

@description('Deployed Container App logical name')
output containerAppName string = appName

@description('ACR login server')
output acrLoginServer string = acr.outputs.loginServer

@description('Key Vault name')
output keyVaultName string = kvName

@description('Cosmos Account endpoint URI')
output cosmosAccountUri string = cosmos.outputs.accountUri

@description('Cosmos DB database name the app should use')
output cosmosDatabaseNameOut string = cosmosDatabaseName

@description('App Insights connection string (for future telemetry)')
output appInsightsConnectionString string = logging.outputs.appInsightsConnectionString

@description('Managed Identity Principal ID (for RBAC grants outside template)')
output managedIdentityPrincipalId string = identity.outputs.principalId

@description('Resource Group ID')
output resourceGroupId string = resourceGroup().id
