@description('ACR name (lowercase, no hyphens)')
param name string
@description('Location')
param location string
@description('SKU (Basic / Standard / Premium)')
param sku string = 'Basic'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: name
  location: location
  sku: { name: sku }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

output loginServer string = registry.properties.loginServer
output resourceId string = registry.id
