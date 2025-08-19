// ==========================================
// Static Web App モジュール
// ==========================================

@description('Static Web App の名前')
param swaName string

@description('Static Web App の場所')
param location string = 'West US 2'

@description('Static Web App のSKU')
param sku string = 'Free'

@description('リソースタグ')
param tags object = {}

@description('GitHub リポジトリの URL')
param repositoryUrl string = ''

@description('GitHub のブランチ名')
param branch string = 'main'

@description('アプリケーションの場所（リポジトリ内）')
param appLocation string = '/swa-chat-ui'

@description('API の場所（リポジトリ内）')
param apiLocation string = ''

@description('ビルド出力の場所')
param outputLocation string = 'dist'

// Static Web App リソース
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: swaName
  location: location
  tags: tags
  sku: {
    name: sku
    tier: sku
  }
  properties: {
    repositoryUrl: repositoryUrl
    branch: branch
    buildProperties: {
      appLocation: appLocation
      apiLocation: apiLocation
      outputLocation: outputLocation
    }
  }
}

// アプリケーション設定（環境変数）
resource appSettings 'Microsoft.Web/staticSites/config@2023-01-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    VITE_API_BASE_URL: 'https://drone-dev-api.blueisland-80a266e9.eastasia.azurecontainerapps.io'
    // VITE_API_KEY は手動で設定するか、GitHub Actions で設定
  }
}

// 出力
output swaResourceId string = staticWebApp.id
output swaDefaultHostname string = staticWebApp.properties.defaultHostname
output swaName string = staticWebApp.name
