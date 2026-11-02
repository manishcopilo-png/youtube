const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('data/manager.db');
db.prepare("UPDATE settings SET setting_value = '50' WHERE setting_key = 'visible_concurrency'").run();
console.log('visible_concurrency updated to 50');
