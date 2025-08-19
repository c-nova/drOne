@description('Cosmos Account name (lowercase)')
param accountName string
@description('Location')
param location string
@description('Database name')
param dbName string
// Serverless baseline; add autoscale param later if needed.

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: 'Enabled'
    capabilities: []
  }
}

resource sqlDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  name: dbName
  parent: account
  properties: {
    resource: { id: dbName }
    options: {}
  }
}

// NOTE: Containers are provisioned application-side; keep infra minimal.

output accountUri string = account.properties.documentEndpoint
output accountId string = account.id
