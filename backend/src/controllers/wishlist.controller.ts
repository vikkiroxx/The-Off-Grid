import { Response } from "express";
import { prisma } from "@/config/prisma";
import { AuthRequest } from "@/middleware/auth";

export async function getWishlist(req: AuthRequest, res: Response) {
  const items = await prisma.wishlistItem.findMany({
    where: { userId: req.user!.id },
    include: { product: { include: { category: true, variants: true } } },
    orderBy: { createdAt: "desc" },
  });

  res.json(items);
}

export async function addToWishlist(req: AuthRequest, res: Response) {
  const { productId } = req.body;

  const item = await prisma.wishlistItem.upsert({
    where: { userId_productId: { userId: req.user!.id, productId } },
    update: {},
    create: { userId: req.user!.id, productId },
    include: { product: { include: { category: true, variants: true } } },
  });

  res.status(201).json(item);
}

export async function removeFromWishlist(req: AuthRequest, res: Response) {
  await prisma.wishlistItem.delete({ where: { id: req.params.id as string } });
  res.status(204).send();
}
