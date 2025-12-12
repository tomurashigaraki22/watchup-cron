import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

const pool = mysql.createPool({
  host: "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: "admin",
  password: "Pityboy@22",
  database: "watchupweb",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: false
  }
});

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function close() {
  await pool.end();
}

