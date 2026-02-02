# mysql-realtime-server

Couche base de données **temps réel** pour MySQL **sans binlog** : événements au niveau application et option changelog (triggers + table).

- **Mode application** : les écritures passent par l’API du package → émission d’événements (WebSocket).
- **Mode changelog** (optionnel) : table `_realtime_changelog` + triggers sur vos tables → un poller lit les changements et les diffuse.

## Installation depuis npm

```bash
npm install mysql-realtime-server
```

## Installation en local (développement)

Si tu veux tester ou modifier le plugin localement :

### 1. Cloner et installer les dépendances

```bash
git clone https://github.com/Andtit4/mysql-realtime-server.git
cd mysql-realtime-server
npm install
```

### 2. Compiler le TypeScript

```bash
npm run build
```

Ceci génère les fichiers JS dans `dist/`.

### 3. Utiliser le plugin en local dans un autre projet

**Option A : Lien symbolique (npm link)**

Dans le dossier du plugin :
```bash
npm link
```

Dans ton projet :
```bash
npm link mysql-realtime-server
```

**Option B : Chemin relatif**

Dans ton projet :
```bash
npm install ../chemin/vers/mysql-realtime-server
```

### 4. Tester le plugin

**Prérequis** : MySQL en cours d'exécution avec une base de données.

```bash
# Créer une base de test
mysql -u root -p
CREATE DATABASE IF NOT EXISTS mydb;
```

**Lancer le test complet** :

```bash
# Mode simple (un cycle d'opérations)
npm run test:realtime

# Mode boucle (opérations toutes les 3 secondes)
npm run test:realtime:loop

# Mode changelog (détecte les INSERT/UPDATE/DELETE faits en SQL direct)
npm run test:realtime:changelog
```

**Tester depuis le navigateur** :

1. Lance le serveur : `npm run test:realtime` ou `npm run test:realtime:changelog`
2. Ouvre `test/test-realtime.html` dans ton navigateur
3. Tu verras les événements en temps réel dans la page

**Variables d'environnement** (optionnel) :

```bash
export MYSQL_HOST=localhost
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=ton_password
export MYSQL_DATABASE=mydb
export REALTIME_PORT=3040

npm run test:realtime
```

**Tester depuis le navigateur méthode api node** :

1. Lance le serveur : `npm run example:node` 
2. Ouvre ` http://localhost:3000/` dans ton navigateur
3. Tu verras les événements en temps réel dans la page avec pour particularité l'utilisation d'une api node

**Variables d'environnement** (optionnel) :

```bash
export MYSQL_HOST=localhost
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=ton_password
export MYSQL_DATABASE=mydb
export REALTIME_PORT=3040

npm run example:node
```

```bash
Server start
  API :       http://localhost:3000/api/users
  Realtime :  ws://localhost:3040/realtime
  Page :      http://localhost:3000/

```

## Utilisation

### Configuration minimale (mode application)

```javascript
const realtime = require('mysql-realtime-db');

const db = realtime.createConnection({
  host: 'localhost',
  user: 'myuser',
  password: 'mypassword',
  database: 'mydb',
  realtime: {
    port: 3040,              // Port du serveur WebSocket
    path: '/realtime'        // Chemin WebSocket (optionnel)
  }
});

await db.connect();
await db.startRealtimeServer();
```

### Écouter les changements (côté serveur)

```javascript
db.on('users:insert', (row) => console.log('Nouveau user:', row));
db.on('users:update', ({ previous, current }) => console.log('Modifié:', previous, '->', current));
db.on('users:delete', (row) => console.log('Supprimé:', row));
db.on('users:*', (event, data) => console.log(event, data));
```

### Écritures qui émettent les événements

```javascript
const id = await db.insert('users', { name: 'Alice', email: 'alice@example.com' });
await db.update('users', { id: 1 }, { name: 'Alice Updated' });
await db.delete('users', { id: 1 });
```

### Requêtes en lecture seule

```javascript
const rows = await db.query('SELECT * FROM users WHERE active = ?', [1]);
```

### Client distant (navigateur ou autre service Node)

```javascript
const client = realtime.createClient({
  url: 'http://localhost:3040',
  path: '/realtime'
});

await client.connect();

client.subscribe('users', (event, data) => {
  console.log(event, data);  // 'insert' | 'update' | 'delete', payload
});

client.subscribe('posts:*', (event, data) => {
  // Tous les événements sur la table posts
});
```

### Mode changelog (capturer toutes les écritures)

Pour détecter les changements même hors de l’application (SQL direct, autre service), installez la table de changelog et les triggers (les tables doivent avoir une colonne `id`) :

```javascript
const db = realtime.createConnection({
  host: 'localhost',
  user: 'app',
  password: '***',
  database: 'mydb',
  realtime: {
    port: 3040,
    enableChangelog: true,
    changelogPollIntervalMs: 500,
    tables: ['users', 'posts', 'comments']
  }
});

await db.connect();
await db.installChangelog();   // Crée _realtime_changelog + triggers
await db.startRealtimeServer();
```

## API

| Méthode | Description |
|--------|-------------|
| `createConnection(options)` | Crée une connexion avec support realtime |
| `db.connect()` | Connexion au pool MySQL |
| `db.startRealtimeServer()` | Démarre le serveur WebSocket |
| `db.on('table:event', fn)` | Écoute insert / update / delete |
| `db.insert(table, data)` | INSERT + émission d’événement |
| `db.update(table, where, data)` | UPDATE + émission d’événement |
| `db.delete(table, where)` | DELETE + émission d’événement |
| `db.query(sql, params)` | Requête arbitraire (pas d’événement) |
| `db.installChangelog()` | Installe la table + triggers (mode changelog) |
| `createClient(options)` | Client pour se connecter au serveur realtime |
| `client.subscribe(pattern, callback)` | Abonnement à une table ou un pattern |

## Licence

MIT
