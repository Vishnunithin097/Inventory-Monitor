import express from 'express';
import type { Request, Response } from 'express'; // Fixed: Type-only imports for ES modules
import { promises as fs } from 'fs';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url'; // Required to safely generate __dirname in ES modules

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;

// Fixed: Safely calculate __dirname since it's not defined globally in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JSON_FILE_PATH = path.join(__dirname, 'inv.json');

app.use(cors());
app.use(express.json());

async function readInventory(): Promise<any[]> {
    try {
        const txt = await fs.readFile(JSON_FILE_PATH, 'utf8');
        return JSON.parse(txt || '[]');
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            // file doesn't exist yet -> return empty inventory
            return [];
        }
        throw err;
    }
}

async function writeInventory(inventory: any[]): Promise<void> {
    await fs.writeFile(JSON_FILE_PATH, JSON.stringify(inventory, null, 2), 'utf8');
}

app.get('/api/inventory', async (_req: Request, res: Response) => {
    try {
        const inventory = await readInventory();
        res.json(inventory);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read inventory data file.' });
    }
});

app.post('/api/inventory', async (req: Request, res: Response) => {
    const newItem = req.body;

    if (!newItem || !newItem.itemId) {
        return res.status(400).json({
            error: 'Request body must include an itemId.'
        });
    }

    try {
        const inventory = await readInventory();

        const existingIndex = inventory.findIndex(
            (it: any) => it.itemId === newItem.itemId
        );

        if (existingIndex > -1) {
            return res.status(409).json({
                error: 'Item already exists. Use PUT to update.'
            });
        }

        inventory.push(newItem);

        await writeInventory(inventory);

        res.json({
            message: 'Inventory added successfully!',
            data: inventory
        });

    } catch (err) {
        res.status(500).json({
            error: 'Failed to write data updates to file.'
        });
    }
});

app.put('/api/inventory/:itemId', async (req: Request, res: Response) => {
    const itemId = req.params.itemId;
    const updatedItem = req.body;

    try {
        const inventory = await readInventory();

        const existingIndex = inventory.findIndex(
            (item: any) => item.itemId === itemId
        );

        if (existingIndex === -1) {
            return res.status(404).json({
                error: 'Inventory item not found.'
            });
        }

        inventory[existingIndex] = updatedItem;

        await writeInventory(inventory);

        res.json({
            message: 'Inventory updated successfully!',
            data: inventory
        });

    } catch (err) {
        res.status(500).json({
            error: 'Failed to update inventory item.'
        });
    }
});

app.delete('/api/inventory/:itemId', async (req: Request, res: Response) => {
    const itemId = req.params.itemId;

    try {
        const inventory = await readInventory();

        const updatedInventory = inventory.filter(
            (item: any) => item.itemId !== itemId
        );

        await writeInventory(updatedInventory);

        res.json({
            message: 'Inventory item deleted successfully!',
            data: updatedInventory
        });

    } catch (err) {
        res.status(500).json({
            error: 'Failed to delete inventory item.'
        });
    }
});

app.listen(PORT, () => {
    console.log(`Backend Inventory Server running on http://localhost:${PORT}`);
});
