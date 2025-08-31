const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const adminPassword = 'Aditi#0409';
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  try {
    const existingUser = await prisma.bankUser.findUnique({
      where: { username: 'ADITI_ADMIN' },
    });

    if (!existingUser) {
      await prisma.bankUser.create({
        data: {
          username: 'ADITI_ADMIN',
          password: hashedPassword, // Store the hashed password
        },
      });
      console.log('Bank user "ADITI_ADMIN" created and hashed password stored!');
    } else {
      console.log('Bank user "ADITI_ADMIN" already exists. Password will be updated.');
      await prisma.bankUser.update({
        where: { username: 'ADITI_ADMIN' },
        data: { password: hashedPassword },
      });
      console.log('Bank user "ADITI_ADMIN" password updated!');
    }
  } catch (e) {
    console.error('Error seeding bank user:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();