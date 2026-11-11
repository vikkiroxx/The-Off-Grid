import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/config/prisma";
import { audienceWhere, parseAudience } from "@/lib/audience";
import { compareSizes } from "@/lib/sizes";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const variantInputSchema = z.object({
  id: z.string().min(1).optional(), // present = update existing variant, absent = create new
  size: z.string().min(1),
  color: z.string().min(1),
  sku: z.string().min(1),
  stock: z.coerce.number().int().min(0),
  priceDelta: z.coerce.number().default(0),
});

const createProductSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(SLUG_PATTERN, "Use lowercase letters, numbers, and hyphens only"),
  description: z.string().min(1),
  price: z.coerce.number().positive(),
  images: z.array(z.string().min(1)).default([]),
  audience: z.enum(["MEN", "WOMEN", "KIDS", "UNISEX"]),
  categoryId: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).optional(),
  variants: z.array(variantInputSchema.omit({ id: true })).default([]),
});

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).regex(SLUG_PATTERN, "Use lowercase letters, numbers, and hyphens only").optional(),
  description: z.string().min(1).optional(),
  price: z.coerce.number().positive().optional(),
  images: z.array(z.string().min(1)).optional(),
  audience: z.enum(["MEN", "WOMEN", "KIDS", "UNISEX"]).optional(),
  categoryId: z.string().min(1).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
  variants: z.array(variantInputSchema).optional(),
});

function productFilters({
  category,
  audience,
  search,
}: {
  category?: string;
  audience?: string;
  search?: string;
}): Prisma.ProductWhereInput {
  return {
    isActive: true,
    ...(category ? { category: { slug: category } } : {}),
    ...audienceWhere(parseAudience(audience)),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function listProducts(req: Request, res: Response) {
  const {
    category,
    audience,
    search,
    size,
    page = "1",
    limit = "20",
  } = req.query as Record<string, string | undefined>;

  const sizes = size
    ? size.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const products = await prisma.product.findMany({
    where: {
      ...productFilters({ category, audience, search }),
      ...(sizes.length ? { variants: { some: { size: { in: sizes } } } } : {}),
    },
    include: { category: true, variants: true },
    skip: (Number(page) - 1) * Number(limit),
    take: Number(limit),
    orderBy: { createdAt: "desc" },
  });

  res.json(products);
}

// Distinct sizes among matching active products' variants, scoped by the
// same category/audience/search filters as listProducts (but not by the
// currently-selected sizes — standard faceted-filter behavior, so toggling
// one size off doesn't make other size options disappear).
export async function listProductSizes(req: Request, res: Response) {
  const { category, audience, search } = req.query as Record<string, string | undefined>;

  const variants = await prisma.variant.findMany({
    where: { product: productFilters({ category, audience, search }) },
    distinct: ["size"],
    select: { size: true },
  });

  res.json(variants.map((v) => v.size).sort(compareSizes));
}

export async function getProduct(req: Request, res: Response) {
  const product = await prisma.product.findUnique({
    where: { slug: req.params.slug as string },
    include: { category: true, variants: true },
  });

  if (!product || !product.isActive) {
    return res.status(404).json({ message: "Product not found" });
  }

  res.json(product);
}

// Admin-only: every product regardless of isActive, looked up by id.
export async function listAdminProducts(req: Request, res: Response) {
  const products = await prisma.product.findMany({
    include: { category: true, variants: true },
    orderBy: { createdAt: "desc" },
  });

  res.json(products);
}

export async function getAdminProduct(req: Request, res: Response) {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id as string },
    include: { category: true, variants: true },
  });

  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }

  res.json(product);
}

export async function createProduct(req: Request, res: Response) {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }

  const { variants, ...fields } = parsed.data;

  try {
    const product = await prisma.product.create({
      data: {
        ...fields,
        attributes: fields.attributes as Prisma.InputJsonValue | undefined,
        variants: { create: variants },
      },
      include: { variants: true, category: true },
    });
    res.status(201).json(product);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res
        .status(409)
        .json({ message: "A product with that slug, or a variant with that SKU, already exists" });
    }
    throw err;
  }
}

export async function updateProduct(req: Request, res: Response) {
  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }

  const { variants, ...fields } = parsed.data;
  const productId = req.params.id as string;

  try {
    const product = await prisma.$transaction(async (tx) => {
      if (variants) {
        const existing = await tx.variant.findMany({
          where: { productId },
          select: { id: true },
        });
        const keepIds = new Set(variants.filter((v) => v.id).map((v) => v.id as string));
        const toDelete = existing.map((v) => v.id).filter((id) => !keepIds.has(id));

        if (toDelete.length > 0) {
          await tx.variant.deleteMany({ where: { id: { in: toDelete } } });
        }

        for (const variant of variants) {
          if (variant.id) {
            await tx.variant.update({
              where: { id: variant.id },
              data: {
                size: variant.size,
                color: variant.color,
                sku: variant.sku,
                stock: variant.stock,
                priceDelta: variant.priceDelta,
              },
            });
          } else {
            await tx.variant.create({ data: { ...variant, productId } });
          }
        }
      }

      return tx.product.update({
        where: { id: productId },
        data: { ...fields, attributes: fields.attributes as Prisma.InputJsonValue | undefined },
        include: { variants: true, category: true },
      });
    });

    res.json(product);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res
        .status(409)
        .json({ message: "A product with that slug, or a variant with that SKU, already exists" });
    }

    // Deleting a variant that already has order history violates OrderItem's
    // FK constraint. Postgres surfaces this as a raw "unknown" query error
    // (no structured Prisma error code), so match on the constraint name.
    const isRestrictedVariantDelete =
      err instanceof Error && err.message.includes("OrderItem_variantId_fkey");
    if (isRestrictedVariantDelete) {
      return res.status(409).json({
        message:
          "Can't remove a variant that already has order history — set its stock to 0 to hide it instead.",
      });
    }

    throw err;
  }
}

export async function deleteProduct(req: Request, res: Response) {
  await prisma.product.update({
    where: { id: req.params.id as string },
    data: { isActive: false },
  });

  res.status(204).send();
}
