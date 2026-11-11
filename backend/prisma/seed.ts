import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

type VariantSeed = { size: string; color: string; sku: string; stock: number };

type ProductSeed = {
  slug: string;
  name: string;
  description: string;
  price: number;
  categorySlug: string;
  audience: "MEN" | "WOMEN" | "KIDS";
  variants: VariantSeed[];
};

// images[0] = primary (front) shot, images[1] = hover (back) shot.
function productImages(label: string): [string, string] {
  const encoded = encodeURIComponent(label);
  return [
    `https://placehold.co/900x1125/0d0f13/eef1f6?text=${encoded}+Front`,
    `https://placehold.co/900x1125/060708/39f3c4?text=${encoded}+Back`,
  ];
}

async function upsertProduct(categoryId: string, seed: ProductSeed) {
  await prisma.product.upsert({
    where: { slug: seed.slug },
    update: { audience: seed.audience, images: productImages(seed.name) },
    create: {
      name: seed.name,
      slug: seed.slug,
      description: seed.description,
      price: seed.price,
      images: productImages(seed.name),
      audience: seed.audience,
      categoryId,
      variants: { create: seed.variants },
    },
  });
}

async function main() {
  await prisma.user.upsert({
    where: { email: "test@example.com" },
    update: {},
    create: {
      name: "Test User",
      email: "test@example.com",
      password: await bcrypt.hash("password123", 10),
      addresses: {
        create: [
          {
            line1: "221B Baker Street",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400001",
            phone: "9876543210",
            isDefault: true,
          },
          {
            line1: "12 MG Road",
            line2: "Near City Mall",
            city: "Bengaluru",
            state: "Karnataka",
            pincode: "560001",
            phone: "9123456780",
            isDefault: false,
          },
        ],
      },
      // Non-zero so manual wallet-checkout testing doesn't require a top-up
      // round-trip first. update: {} on the outer upsert means a reseed won't
      // reset a balance that's since changed by manual testing.
      wallet: {
        create: { balance: 500 },
      },
    },
  });

  const categorySeeds = [
    { name: "T-Shirts", slug: "t-shirts" },
    { name: "Hoodies", slug: "hoodies" },
    { name: "Cargo Pants", slug: "cargo-pants" },
    { name: "Jackets", slug: "jackets" },
  ];

  const resolvedCategories: Record<string, { id: string }> = {};
  for (const c of categorySeeds) {
    resolvedCategories[c.slug] = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: c,
    });
  }

  const productSeeds: ProductSeed[] = [
    {
      slug: "classic-oversized-tee",
      name: "Classic Oversized Tee",
      description: "100% cotton oversized fit t-shirt.",
      price: 799,
      categorySlug: "t-shirts",
      audience: "MEN",
      variants: [
        { size: "S", color: "Black", sku: "TEE-BLK-S", stock: 20 },
        { size: "M", color: "Black", sku: "TEE-BLK-M", stock: 25 },
        { size: "L", color: "Black", sku: "TEE-BLK-L", stock: 15 },
      ],
    },
    {
      slug: "graphic-print-tee",
      name: "Graphic Print Tee",
      description: "Relaxed fit tee with front graphic print.",
      price: 899,
      categorySlug: "t-shirts",
      audience: "KIDS",
      variants: [
        { size: "S", color: "White", sku: "GTEE-WHT-S", stock: 18 },
        { size: "M", color: "White", sku: "GTEE-WHT-M", stock: 22 },
        { size: "L", color: "White", sku: "GTEE-WHT-L", stock: 4 },
      ],
    },
    {
      slug: "pullover-hoodie",
      name: "Pullover Hoodie",
      description: "Heavyweight fleece pullover hoodie.",
      price: 1899,
      categorySlug: "hoodies",
      audience: "WOMEN",
      variants: [
        { size: "M", color: "Charcoal", sku: "HOOD-CHR-M", stock: 12 },
        { size: "L", color: "Charcoal", sku: "HOOD-CHR-L", stock: 10 },
        { size: "XL", color: "Charcoal", sku: "HOOD-CHR-XL", stock: 0 },
      ],
    },
    {
      slug: "zip-up-hoodie",
      name: "Zip-Up Hoodie",
      description: "Full-zip hoodie with kangaroo pocket.",
      price: 2099,
      categorySlug: "hoodies",
      audience: "KIDS",
      variants: [
        { size: "S", color: "Navy", sku: "ZHOOD-NVY-S", stock: 14 },
        { size: "M", color: "Navy", sku: "ZHOOD-NVY-M", stock: 3 },
      ],
    },
    {
      slug: "utility-cargo-pants",
      name: "Utility Cargo Pants",
      description: "Six-pocket utility cargo pants with adjustable cuffs.",
      price: 1799,
      categorySlug: "cargo-pants",
      audience: "MEN",
      variants: [
        { size: "30", color: "Olive", sku: "CARGO-OLV-30", stock: 16 },
        { size: "32", color: "Olive", sku: "CARGO-OLV-32", stock: 20 },
        { size: "34", color: "Olive", sku: "CARGO-OLV-34", stock: 9 },
      ],
    },
    {
      slug: "relaxed-cargo-joggers",
      name: "Relaxed Cargo Joggers",
      description: "Tapered-fit cargo joggers with elastic waistband.",
      price: 1599,
      categorySlug: "cargo-pants",
      audience: "WOMEN",
      variants: [
        { size: "M", color: "Black", sku: "JOG-BLK-M", stock: 25 },
        { size: "L", color: "Black", sku: "JOG-BLK-L", stock: 2 },
      ],
    },
    {
      slug: "bomber-jacket",
      name: "Bomber Jacket",
      description: "Water-resistant bomber jacket with ribbed trims.",
      price: 3299,
      categorySlug: "jackets",
      audience: "MEN",
      variants: [
        { size: "M", color: "Black", sku: "BOMB-BLK-M", stock: 8 },
        { size: "L", color: "Black", sku: "BOMB-BLK-L", stock: 6 },
      ],
    },
    {
      slug: "windbreaker-jacket",
      name: "Windbreaker Jacket",
      description: "Lightweight packable windbreaker.",
      price: 2499,
      categorySlug: "jackets",
      audience: "WOMEN",
      variants: [
        { size: "S", color: "Electric Teal", sku: "WIND-TEAL-S", stock: 11 },
        { size: "M", color: "Electric Teal", sku: "WIND-TEAL-M", stock: 0 },
      ],
    },
    {
      slug: "crew-neck-tee",
      name: "Crew Neck Tee",
      description: "Slim fit crew neck tee in breathable cotton.",
      price: 749,
      categorySlug: "t-shirts",
      audience: "MEN",
      variants: [
        { size: "M", color: "Grey", sku: "CREW-GRY-M", stock: 19 },
        { size: "L", color: "Grey", sku: "CREW-GRY-L", stock: 13 },
      ],
    },
    {
      slug: "textured-hoodie",
      name: "Textured Hoodie",
      description: "Brushed-back fleece hoodie with ribbed hem.",
      price: 1999,
      categorySlug: "hoodies",
      audience: "MEN",
      variants: [
        { size: "M", color: "Stone", sku: "THOOD-STN-M", stock: 15 },
        { size: "L", color: "Stone", sku: "THOOD-STN-L", stock: 7 },
      ],
    },
    {
      slug: "track-jacket",
      name: "Track Jacket",
      description: "Retro-stripe zip track jacket.",
      price: 2199,
      categorySlug: "jackets",
      audience: "MEN",
      variants: [
        { size: "M", color: "Navy", sku: "TRACK-NVY-M", stock: 10 },
        { size: "L", color: "Navy", sku: "TRACK-NVY-L", stock: 5 },
      ],
    },
    {
      slug: "cropped-tee",
      name: "Cropped Tee",
      description: "Boxy cropped tee in soft cotton jersey.",
      price: 699,
      categorySlug: "t-shirts",
      audience: "WOMEN",
      variants: [
        { size: "S", color: "White", sku: "CROP-WHT-S", stock: 21 },
        { size: "M", color: "White", sku: "CROP-WHT-M", stock: 17 },
      ],
    },
    {
      slug: "high-waist-cargo-pants",
      name: "High-Waist Cargo Pants",
      description: "High-rise cargo pants with cinched ankle.",
      price: 1899,
      categorySlug: "cargo-pants",
      audience: "WOMEN",
      variants: [
        { size: "S", color: "Khaki", sku: "HWCARGO-KHK-S", stock: 14 },
        { size: "M", color: "Khaki", sku: "HWCARGO-KHK-M", stock: 12 },
      ],
    },
    {
      slug: "puffer-jacket",
      name: "Puffer Jacket",
      description: "Quilted puffer jacket with stand collar.",
      price: 2999,
      categorySlug: "jackets",
      audience: "WOMEN",
      variants: [
        { size: "S", color: "Maroon", sku: "PUFF-MRN-S", stock: 9 },
        { size: "M", color: "Maroon", sku: "PUFF-MRN-M", stock: 6 },
      ],
    },
    {
      slug: "dino-print-tee",
      name: "Dino Print Tee",
      description: "Soft cotton tee with a dinosaur print.",
      price: 599,
      categorySlug: "t-shirts",
      audience: "KIDS",
      variants: [
        { size: "4-5Y", color: "Yellow", sku: "DINO-YLW-4", stock: 16 },
        { size: "6-7Y", color: "Yellow", sku: "DINO-YLW-6", stock: 12 },
      ],
    },
    {
      slug: "fleece-hoodie-kids",
      name: "Fleece Hoodie",
      description: "Warm fleece-lined hoodie for everyday wear.",
      price: 1099,
      categorySlug: "hoodies",
      audience: "KIDS",
      variants: [
        { size: "4-5Y", color: "Sky Blue", sku: "KHOOD-SKY-4", stock: 11 },
        { size: "6-7Y", color: "Sky Blue", sku: "KHOOD-SKY-6", stock: 8 },
      ],
    },
    {
      slug: "cargo-shorts-kids",
      name: "Cargo Shorts",
      description: "Durable cargo shorts with elastic waistband.",
      price: 799,
      categorySlug: "cargo-pants",
      audience: "KIDS",
      variants: [
        { size: "4-5Y", color: "Beige", sku: "KCARGO-BGE-4", stock: 13 },
        { size: "6-7Y", color: "Beige", sku: "KCARGO-BGE-6", stock: 10 },
      ],
    },
    {
      slug: "puffer-jacket-kids",
      name: "Kids Puffer Jacket",
      description: "Lightweight insulated puffer jacket for kids.",
      price: 1499,
      categorySlug: "jackets",
      audience: "KIDS",
      variants: [
        { size: "4-5Y", color: "Red", sku: "KPUFF-RED-4", stock: 9 },
        { size: "6-7Y", color: "Red", sku: "KPUFF-RED-6", stock: 7 },
      ],
    },
  ];

  for (const seed of productSeeds) {
    await upsertProduct(resolvedCategories[seed.categorySlug]!.id, seed);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
