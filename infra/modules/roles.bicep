@description('Principal ID (UAMI)')
param principalId string
@description('ACR resource ID')
param acrId string
@description('Cosmos account ID')
param cosmosId string
@description('Key Vault ID')
param keyVaultId string

var roleAcrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var roleCosmosDataContributor = '5bd9cd88-fe45-4216-938b-f97437e15450'
var roleKeyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'

// Use extension resource syntax with explicit scopes
resource acrScope 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: last(split(acrId, '/')) }
resource cosmosScope 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' existing = { name: last(split(cosmosId, '/')) }
resource kvScope 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: last(split(keyVaultId, '/')) }

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acrId, principalId, roleAcrPull)
  scope: acrScope
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAcrPull)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

resource cosmosDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(cosmosId, principalId, roleCosmosDataContributor)
  scope: cosmosScope
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleCosmosDataContributor)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVaultId, principalId, roleKeyVaultSecretsUser)
  scope: kvScope
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultSecretsUser)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

output assignedRoles array = [acrPull.id, cosmosDataContributor.id, kvSecretsUser.id]
