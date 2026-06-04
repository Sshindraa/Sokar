const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.restaurant.findFirst({
    where: { phoneNumber: "+33102030405" }
  });

  if (existing) {
    console.log("Le restaurant test existe déjà ! ID :", existing.id);
    return;
  }

  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Le Bistrot Gourmand",
      plan: "PRO",
      managerPhone: "+33600000000",
      managerEmail: "contact@bistrotgourmand.fr",
      phoneNumber: "+33102030405",
      smsConfirmEnabled: true,
      openingHours: {
        mon: { open: "12:00", close: "22:30" },
        tue: { open: "12:00", close: "22:30" },
        wed: { open: "12:00", close: "22:30" },
        thu: { open: "12:00", close: "22:30" },
        fri: { open: "12:00", close: "23:00" },
        sat: { open: "12:00", close: "23:00" },
        sun: { open: "18:00", close: "22:30" }
      }
    }
  });

  console.log("Restaurant de test créé avec succès ! ID :", restaurant.id);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
