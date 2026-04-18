module.exports = {
  apps: [
    {
      name: "CRM",
      script: "./src/server.js",
      instances: 1,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 5001,
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
      watch: false,
      max_memory_restart: "1G",
      restart_delay: 4000,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
    },
  ],
};
