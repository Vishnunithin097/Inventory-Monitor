import express from 'express';
import type { Request, Response } from 'express'; 
import { promises as fs } from 'fs';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url'; 
import mysql from 'mysql2/promise'; 
import 'dotenv/config'; 

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JSON_FILE_PATH = path.join(__dirname, 'inv.json');

app.use(cors());
app.use(express.json());


const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, 
    database: process.env.DB_NAME, 
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});


async function readInventory(): Promise<any[]> {
    try {
        const txt = await fs.readFile(JSON_FILE_PATH, 'utf8');
        return JSON.parse(txt || '[]');
    } catch (err: any) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

async function writeInventory(inventory: any[]): Promise<void> {
    await fs.writeFile(JSON_FILE_PATH, JSON.stringify(inventory, null, 2), 'utf8');
}

// ==================================================================
// 📂 INVENTORY APIs 
// ==================================================================
app.get('/api/inventory', async (_req: Request, res: Response) => {
    try {
        const inventory = await readInventory();
        res.json(inventory);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read inventory data.' });
    }
});

app.post('/api/inventory', async (req: Request, res: Response) => {
    const newItem = req.body;
    try {
        const inventory = await readInventory();
        inventory.push(newItem);
        await writeInventory(inventory);
        res.json({ message: 'Success', data: inventory });
    } catch (err) {
        res.status(500).json({ error: 'Failed to write data.' });
    }
});

app.put('/api/inventory/:itemId', async (req: Request, res: Response) => {
    const itemId = req.params.itemId;
    const updatedItem = req.body;
    try {
        const inventory = await readInventory();
        const idx = inventory.findIndex((it: any) => it.itemId === itemId);
        if (idx > -1) {
            inventory[idx] = updatedItem;
            await writeInventory(inventory);
            res.json({ message: 'Updated', data: inventory });
        } else {
            res.status(404).json({ error: 'Not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to update.' });
    }
});

app.delete('/api/inventory/:itemId', async (req: Request, res: Response) => {
    const itemId = req.params.itemId;
    try {
        const inventory = await readInventory();
        const updated = inventory.filter((it: any) => it.itemId !== itemId);
        await writeInventory(updated);
        res.json({ message: 'Deleted', data: updated });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete.' });
    }
});

// ==================================================================
// 👥 EMPLOYEE APIs 
// ==================================================================
app.get('/api/employees', async (_req: Request, res: Response) => {
    try {
        // உங்க டேபிள் பெயர் 'employee_inv' தானு கன்பார்ம் பண்ணிக்கோங்க!
        const [rows] = await db.query('SELECT * FROM employee_inv'); 
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to read employee data.' });
    }
});

app.listen(PORT, () => {
    console.log(`Backend Server running on http://localhost:${PORT}`);
});