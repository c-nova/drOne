@description('Container Apps Environment name')
param name string
@description('Location')
param location string
@description('Log Analytics Workspace Resource ID')
param logAnalyticsWorkspaceId string

// Use existing declaration to cleanly access properties (customerId is nested under properties)
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: last(split(logAnalyticsWorkspaceId, '/'))
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: name
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
  // listKeys still required to fetch shared key (no direct property exposure)
  sharedKey: listKeys(resourceId('Microsoft.OperationalInsights/workspaces', law.name), '2023-09-01').primarySharedKey
      }
    }
  }
}

output environmentId string = env.id
