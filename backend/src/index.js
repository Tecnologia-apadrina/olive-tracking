const app = require('./app');
const { startDailyBackups } = require('./services/backup');
const PORT = process.env.PORT || 3000;

startDailyBackups();

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
