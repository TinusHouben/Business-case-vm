import "dotenv/config";
import logger from "../utils/logger";
import { RabbitMQConsumer } from "./consumer";

async function main() {
  logger.info("Starting RabbitMQ consumer...");

  // Als jouw RabbitMQConsumer constructor args verwacht, pas dit aan.
  // In de file die je net van mij kreeg verwacht hij GEEN args.
  const consumer = new RabbitMQConsumer();

  await consumer.connect();
  await consumer.startConsuming();

  logger.info("RabbitMQ consumer is running (waiting for messages)...");
}

main().catch((err) => {
  logger.error("Consumer crashed", { err });
  process.exit(1);
});
