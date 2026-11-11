import { Response } from "express";
import { prisma } from "@/config/prisma";
import { AuthRequest } from "@/middleware/auth";

export async function getCart(req: AuthRequest, res: Response) {
  const items = await prisma.cartItem.findMany({
    where: { userId: req.user!.id },
    // Nested variants so the frontend can offer a size/color switcher per line.
    include: { variant: { include: { product: { include: { variants: true } } } } },
  });

  res.json(items);
}

export async function addToCart(req: AuthRequest, res: Response) {
  const { variantId, quantity = 1 } = req.body;

  const item = await prisma.cartItem.upsert({
    where: { userId_variantId: { userId: req.user!.id, variantId } },
    update: { quantity: { increment: quantity } },
    create: { userId: req.user!.id, variantId, quantity },
  });

  res.status(201).json(item);
}

export async function updateCartItem(req: AuthRequest, res: Response) {
  const { quantity, variantId } = req.body;

  const current = await prisma.cartItem.findUnique({
    where: { id: req.params.id as string },
    include: { variant: true },
  });
  if (!current || current.userId !== req.user!.id) {
    res.status(404).json({ message: "Cart item not found" });
    return;
  }

  // Swapping size/color (e.g. from the cart page) moves this line to a
  // different variantId rather than just changing its quantity.
  if (variantId && variantId !== current.variantId) {
    const targetVariant = await prisma.variant.findUnique({ where: { id: variantId } });
    if (!targetVariant || targetVariant.productId !== current.variant.productId) {
      res.status(400).json({ message: "Invalid variant" });
      return;
    }
    if (targetVariant.stock <= 0) {
      res.status(400).json({ message: "Selected option is out of stock" });
      return;
    }

    const nextQuantity = quantity ?? current.quantity;

    // The target variant may already be its own cart line (userId+variantId
    // is unique) — merge into it instead of violating that constraint.
    const existing = await prisma.cartItem.findUnique({
      where: { userId_variantId: { userId: req.user!.id, variantId } },
    });
    if (existing) {
      const merged = await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: { increment: nextQuantity } },
      });
      await prisma.cartItem.delete({ where: { id: current.id } });
      res.json(merged);
      return;
    }

    const moved = await prisma.cartItem.update({
      where: { id: current.id },
      data: { variantId, quantity: nextQuantity },
    });
    res.json(moved);
    return;
  }

  const item = await prisma.cartItem.update({
    where: { id: current.id },
    data: { quantity },
  });

  res.json(item);
}

export async function removeFromCart(req: AuthRequest, res: Response) {
  await prisma.cartItem.delete({ where: { id: req.params.id as string } });
  res.status(204).send();
}
