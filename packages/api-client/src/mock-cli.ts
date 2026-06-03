import { startMockServer } from "./mock-server";

const port = Number(process.env.MOCK_PORT ?? 8788);
const { url } = await startMockServer(port);
console.log(`Lectern mock API listening at ${url}`);
