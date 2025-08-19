@description('Container App name')
param name string
@description('Location')
param location string
@description('Environment name (resource)')
param envName string
@description('Container image')
param image string
@description('Target port')
param targetPort int = 8080
@description('vCPU (e.g., 0.5, 1, 2)')
param cpu int = 1
@description('Memory (Gi)')
param memory string = '1Gi'
@description('Min replicas')
param minReplicas int = 1
@description('Max replicas')
param maxReplicas int = 3
@description('User Assigned Identity resource ID')
param uamiResourceId string
@description('User Assigned Identity clientId (for AZURE_CLIENT_ID env)')
param uamiClientId string
@description('ACR server (login server)')
param acrServer string
@description('Cosmos Account URI')
param cosmosAccountUri string
@description('Cosmos DB name')
param cosmosDbName string
@description('Key Vault name')
param keyVaultName string
@description('Optional revision suffix (<=20 chars, lowercase/num/-). If empty defaults to r1')
param revisionSuffix string = 'r1'
@description('Allow anonymous (string value 1 or 0 passed)')
param allowAnonymousParam bool = true
@description('Optional API key secret name in Key Vault')
param apiKeySecretName string = ''
@description('Optional API key secret version in Key Vault')
param apiKeySecretVersion string = ''
// (logWorkspaceId reserved for future; removed to avoid unused param warning)

var envId = resourceId('Microsoft.App/managedEnvironments', envName)

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uamiResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: envId
    configuration: {
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
      }
      registries: [
        {
          server: acrServer
          identity: uamiResourceId
        }
      ]
      activeRevisionsMode: 'single'
      secrets: apiKeySecretName == '' ? [] : [
        {
          // Key Vault secret reference (version optional)
          name: 'api-key'
          keyVaultUrl: apiKeySecretVersion == '' ? 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/${apiKeySecretName}' : 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/${apiKeySecretName}/${apiKeySecretVersion}'
          identity: uamiResourceId
        }
      ]
    }
    template: {
  revisionSuffix: revisionSuffix
      containers: [
        {
          name: 'api'
          image: image
          resources: {
            cpu: cpu
            memory: memory
          }
          env: concat([
            { name: 'PORT', value: string(targetPort) }
            { name: 'DATABASE_PROVIDER', value: 'cosmos' }
            // Tell DefaultAzureCredential which user-assigned identity to use
            { name: 'AZURE_CLIENT_ID', value: uamiClientId }
            { name: 'ALLOW_ANONYMOUS', value: allowAnonymousParam ? '1' : '0' }
            // App expects COSMOS_DB_ACCOUNT_URI (or legacy COSMOS_DB_URI) & COSMOS_DB_DATABASE
            { name: 'COSMOS_DB_ACCOUNT_URI', value: cosmosAccountUri }
            { name: 'COSMOS_DB_DATABASE', value: cosmosDbName }
            // Backward compat (remove later)
            { name: 'COSMOS_ACCOUNT_URI', value: cosmosAccountUri }
            { name: 'COSMOS_DB_NAME', value: cosmosDbName }
            { name: 'KEY_VAULT_NAME', value: keyVaultName }
            // Build KV URI using cloud suffix for portability
            { name: 'KEY_VAULT_URI', value: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}' }
          ], apiKeySecretName == '' ? [] : [ { name: 'API_KEY', secretRef: 'api-key' } ])
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output resourceId string = app.id
