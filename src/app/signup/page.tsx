"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";

import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { useAuthContext } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";

const signupSchema = z.object({
  fullName: z
    .string()
    .min(2, { message: "Full name must be at least 2 characters" }),
  email: z.string().email({ message: "Invalid email address" }),
  password: z
    .string()
    .min(6, { message: "Password must be at least 6 characters" }),
});

type SignupFormValues = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const loginImage = PlaceHolderImages.find(
    (img) => img.id === "login-background"
  );
  const { user, loading, isAuthenticated, register, error, clearError } =
    useAuthContext();
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    if (!loading && isAuthenticated && user) {
      router.push("/dashboard");
    }
  }, [user, loading, isAuthenticated, router]);

  useEffect(() => {
    if (error) {
      toast({
        variant: "destructive",
        title: "Signup Failed",
        description: error,
      });
      clearError();
    }
  }, [error, toast, clearError]);

  const onSubmit = async (data: SignupFormValues) => {
    try {
      await register(data.email, data.password, data.fullName);
      toast({
        title: "Account Created",
        description: "Your account has been created successfully!",
      });
    } catch (error: any) {
      // Error is handled by the auth context and displayed via toast
      console.error("Signup error:", error);
    }
  };

  const handleGoogleSignUp = () => {
    toast({
      title: "Feature coming soon",
      description: "Google Sign-Up is not yet implemented.",
    });
  };

  if (loading || (!loading && isAuthenticated && user)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="w-full lg:grid lg:min-h-[100vh] lg:grid-cols-2">
      <div className="flex items-center justify-center py-12 px-4 order-2 lg:order-1">
        <div className="mx-auto grid w-[350px] gap-6">
          <div className="grid gap-2 text-center">
            <h1 className="text-3xl font-bold">Sign Up</h1>
            <p className="text-balance text-muted-foreground">
              Create your account to start collaborating
            </p>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <Label htmlFor="full-name">Full Name</Label>
                    <FormControl>
                      <Input id="full-name" placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <Label htmlFor="email">Email</Label>
                    <FormControl>
                      <Input
                        id="email"
                        type="email"
                        placeholder="m@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <Label htmlFor="password">Password</Label>
                    <FormControl>
                      <Input id="password" type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting
                  ? "Creating account..."
                  : "Create an account"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                type="button"
                onClick={handleGoogleSignUp}
              >
                Sign up with Google
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm">
            Already have an account?{" "}
            <Link href="/" className="underline">
              Login
            </Link>
          </div>
        </div>
      </div>
      <div className="hidden bg-muted lg:block relative order-1 lg:order-2">
        {loginImage && (
          <Image
            src={loginImage.imageUrl}
            alt={loginImage.description}
            data-ai-hint={loginImage.imageHint}
            fill
            className="object-cover"
          />
        )}
        <div className="relative z-10 flex flex-col justify-between h-full p-10 bg-black/50 text-white">
          <div className="flex items-center gap-2 text-2xl font-bold">
            <AppLogo className="h-8 w-8 text-primary" />
            GoMeet
          </div>
          <div className="text-lg">
            <blockquote className="space-y-2">
              <p className="font-medium">
                “This platform has revolutionized how our team collaborates. The
                video quality and reliability are second to none.”
              </p>
              <footer className="text-sm font-normal text-gray-300">
                Sofia Davis, Project Manager
              </footer>
            </blockquote>
          </div>
        </div>
      </div>
    </div>
  );
}
