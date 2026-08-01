import net from 'node:net';

const minimumNode = 18;
const major = Number(process.versions.node.split('.')[0]);
if (!Number.isInteger(major) || major < minimumNode) {
  console.error(`需要 Node.js ${minimumNode} 或更高版本；当前为 ${process.versions.node}。`);
  process.exit(1);
}
const argument = process.argv.find((item) => item.startsWith('--port='));
const raw = argument ? argument.split('=')[1] : process.env.PORT || '4173';
const port = Number(raw);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`端口无效：${raw}`);
  process.exit(1);
}
const probe = net.createServer();
probe.once('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`端口 ${port} 已被占用。请关闭占用程序，或设置 PORT=4174。`);
  else console.error(`端口检查失败：${error.message}`);
  process.exit(1);
});
probe.once('listening', () => {
  probe.close(() => {
    console.log(`预检通过：Node.js ${process.versions.node}，端口 ${port} 可用。`);
  });
});
probe.listen(port, '127.0.0.1');
