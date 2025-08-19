@description('Key Vault name')
param name string
@description('Location')
param location string
@description('Tenant ID')
param tenantId string
// RBAC assignments handled externally (roles.bicep)

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  properties: {
    tenantId: tenantId
    sku: {
      name: 'standard'
      family: 'A'
    }
    enableRbacAuthorization: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

output vaultUri string = kv.properties.vaultUri
output vaultId string = kv.id
