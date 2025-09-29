import type { Express } from "express";
import { createServer, type Server } from "http";
import { 
  insertEmailSubscriberSchema,
  insertCategorySchema,
  insertKeywordSchema,
  updateKeywordSchema,
  scrapeProductRequestSchema,
  chatRequestSchema,
  chatResponseSchema,
  optimizationStateSchema,
  insertAdClientSchema,
  insertAdCampaignSchema,
  insertOptimizationRecommendationSchema,
  insertCampaignResultSchema,
  insertTrainingMaterialSchema,
} from "@shared/schema";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
import { fromZodError } from "zod-validation-error";
import { z } from "zod";
import multer from "multer";
import crypto from "crypto";
import { scrapeProductFromUrl } from "./scraper";

// User activity tracking helper functions
function generateSessionId(): string {
  return crypto.randomUUID();
}

async function trackUserActivity(
  userId: string | null, 
  sessionId: string | null, 
  activityType: string, 
  activityData?: any
) {
  try {
    if (!sessionId) return;
    
    await storage.createUserActivity({
      userId: userId || undefined,
      sessionId,
      activityType,
      activityData: activityData ? JSON.stringify(activityData) : undefined,
    });
  } catch (error) {
    console.error('Error tracking user activity:', error);
  }
}

// Beehiiv API integration
async function addToBeehiivNewsletter(email: string, retryCount: number = 0): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  try {
    const apiKey = process.env.BEEHIIV_API_KEY;
    const publicationId = process.env.BEEHIIV_PUBLICATION_ID;

    if (!apiKey || !publicationId) {
      console.warn('Beehiiv API credentials not found, skipping newsletter subscription');
      return { success: false, error: 'API credentials not configured' };
    }

    const response = await fetch('https://api.beehiiv.com/v2/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        reactivate_existing: false,
        send_welcome_email: true,
        utm_source: 'rankster_website',
        utm_medium: 'organic',
        utm_campaign: 'signup',
        referring_site: 'rankster.co',
        publication_id: publicationId
      }),
    });

    const responseData = await response.text();
    console.log('Beehiiv response status:', response.status);
    console.log('Beehiiv response:', responseData);
    
    let parsedData;
    try {
      parsedData = JSON.parse(responseData);
    } catch (e) {
      console.error('Failed to parse Beehiiv response as JSON:', responseData);
      return { success: false, error: 'Invalid response format', statusCode: response.status };
    }

    if (response.ok) {
      return { success: true };
    } else if (response.status === 409) {
      // User already exists, which is fine
      console.log('User already subscribed to newsletter:', email);
      return { success: true };
    } else if (response.status >= 500 && retryCount < 3) {
      // Retry on server errors
      console.log(`Retrying Beehiiv API call (attempt ${retryCount + 1})...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return addToBeehiivNewsletter(email, retryCount + 1);
    } else {
      return { 
        success: false, 
        error: parsedData?.errors?.[0]?.detail || `API error: ${response.status}`,
        statusCode: response.status 
      };
    }
  } catch (error: any) {
    console.error('Beehiiv API error:', error);
    if (retryCount < 3) {
      console.log(`Retrying Beehiiv API call (attempt ${retryCount + 1})...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return addToBeehiivNewsletter(email, retryCount + 1);
    }
    return { success: false, error: error.message || 'Network error' };
  }
}

// Training materials file upload configuration
const trainingMaterialStorage = multer.memoryStorage();
const trainingMaterialUpload = multer({
  storage: trainingMaterialStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept text files, PDFs, docs
    const allowedTypes = [
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload text, markdown, or PDF files.'));
    }
  }
});

export function registerRoutes(app: Express): Server {
  // Initialize Replit authentication
  setupAuth(app);

  // User activity tracking middleware
  app.use('/api', async (req, res, next) => {
    if (!req.session) {
      return next();
    }

    // Generate or get session tracking ID
    let trackingSessionId = (req as any).trackingSessionId;
    if (!trackingSessionId) {
      trackingSessionId = generateSessionId();
      (req as any).trackingSessionId = trackingSessionId;
    }

    // Track search activities
    if (req.path.includes('/search') || req.path.includes('/keywords')) {
      const userId = (req.session as any)?.user?.id || (req.session as any)?.adminUser?.id || null;
      
      // Only track actual usage, not just page loads
      if (req.method === 'GET' && req.query.q) {
        await trackUserActivity(
          userId,
          trackingSessionId,
          'keyword_search',
          { 
            query: req.query.q,
            category: req.query.category,
            page: req.query.page 
          }
        );
      }
    }

    next();
  });

  // Simple admin login endpoint
  app.post('/api/admin/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      console.log('Login attempt:', { email, password: password ? '***' : 'missing' });
      
      // Simple admin credentials (in production, use proper hashing)
      if (email === 'paul@rankster.co' && password === 'Hannah12') {
        // Ensure admin user exists in database first
        const dbUser = await storage.upsertUser({
          id: 'paul@rankster.co',
          email: 'paul@rankster.co',
          firstName: 'Paul',
          lastName: 'Admin',
          role: 'admin'
        });
        
        // Set session using the DB user data
        (req.session as any).adminUser = {
          id: dbUser.id,
          email: dbUser.email,
          role: 'admin',
          firstName: dbUser.firstName,
          lastName: dbUser.lastName
        };
        
        console.log('Session set:', (req.session as any).adminUser);
        await new Promise((resolve) => req.session.save(resolve));

        // Track login activity
        await trackUserActivity(
          'paul@rankster.co',
          (req as any).trackingSessionId,
          'admin_login',
          { email }
        );
        
        res.json({
          success: true,
          user: (req.session as any).adminUser
        });
      } else {
        console.log('Invalid credentials for:', email);
        res.status(401).json({ message: 'Invalid credentials' });
      }
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: 'Login failed' });
    }
  });

  // User session check endpoint
  app.get('/api/auth/user', async (req, res) => {
    try {
      console.log('Checking session:', req.session);
      
      // Check for admin session first
      const adminUser = (req.session as any)?.adminUser;
      console.log('Admin user from session:', adminUser);
      
      if (adminUser) {
        return res.json(adminUser);
      }

      // Check for regular user session
      const user = (req.session as any)?.user;
      console.log('Regular user from session:', user);
      
      if (user) {
        return res.json(user);
      }

      // Fallback to Replit Auth if available
      if (req.isAuthenticated && req.isAuthenticated() && req.user) {
        const userId = (req.user as any).claims?.sub;
        if (userId) {
          const authUser = await storage.getUser(userId);
          return res.json(authUser);
        }
      }

      res.status(401).json({ message: "Unauthorized" });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Logout endpoints
  app.post('/api/admin/logout', (req, res) => {
    (req.session as any).adminUser = null;
    res.json({ success: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    (req.session as any).user = null;
    (req.session as any).adminUser = null;
    res.json({ success: true });
  });

  // Admin statistics endpoints
  app.get('/api/admin/stats/daily', isAdmin, async (req, res) => {
    try {
      const dailyStats = await storage.getUserActivities();
      res.json(dailyStats);
    } catch (error) {
      console.error('Error fetching daily stats:', error);
      res.status(500).json({ message: 'Failed to fetch daily stats' });
    }
  });

  app.get('/api/admin/stats/weekly', isAdmin, async (req, res) => {
    try {
      const weeklyStats = await storage.getUserActivities();
      res.json(weeklyStats);
    } catch (error) {
      console.error('Error fetching weekly stats:', error);
      res.status(500).json({ message: 'Failed to fetch weekly stats' });
    }
  });

  app.get('/api/admin/stats/monthly', isAdmin, async (req, res) => {
    try {
      const monthlyStats = await storage.getMonthlyUsageStats();
      res.json(monthlyStats);
    } catch (error) {
      console.error('Error fetching monthly stats:', error);
      res.status(500).json({ message: 'Failed to fetch monthly stats' });
    }
  });

  app.get('/api/admin/stats/activities', isAdmin, async (req, res) => {
    try {
      const activities = await storage.getUserActivities();
      res.json(activities);
    } catch (error) {
      console.error('Error fetching activities:', error);
      res.status(500).json({ message: 'Failed to fetch activities' });
    }
  });

  app.get('/api/admin/stats/overview', isAdmin, async (req, res) => {
    try {
      const overview = await storage.getUserActivities();
      res.json(overview);
    } catch (error) {
      console.error('Error fetching overview:', error);
      res.status(500).json({ message: 'Failed to fetch overview' });
    }
  });

  // Beehiiv integration endpoints
  app.post('/api/admin/sync-beehiiv', isAdmin, async (req, res) => {
    try {
      const subscribers = await storage.getEmailSubscribers();
      const results = [];
      
      for (const subscriber of subscribers) {
        const result = await addToBeehiivNewsletter(subscriber.email);
        results.push({
          email: subscriber.email,
          success: result.success,
          error: result.error
        });
      }
      
      res.json({ results });
    } catch (error) {
      console.error('Beehiiv sync error:', error);
      res.status(500).json({ message: 'Failed to sync with Beehiiv' });
    }
  });

  app.post('/api/admin/test-beehiiv', isAdmin, async (req, res) => {
    try {
      const testEmail = req.body.email || 'test@example.com';
      const result = await addToBeehiivNewsletter(testEmail);
      res.json(result);
    } catch (error) {
      console.error('Beehiiv test error:', error);
      res.status(500).json({ message: 'Failed to test Beehiiv' });
    }
  });

  // Activity tracking endpoint
  app.post('/api/activity/track', async (req, res) => {
    try {
      const { activityType, activityData } = req.body;
      const userId = (req.session as any)?.user?.id || (req.session as any)?.adminUser?.id || null;
      
      await trackUserActivity(
        userId,
        (req as any).trackingSessionId,
        activityType,
        activityData
      );
      
      res.json({ success: true });
    } catch (error) {
      console.error('Activity tracking error:', error);
      res.status(500).json({ message: 'Failed to track activity' });
    }
  });

  // User signup endpoint for email authentication
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ message: 'Email is required' });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }

      // Create or find user account
      const userData = {
        id: email, // Use email as ID for simplicity
        email: email,
        firstName: null,
        lastName: null,
        profileImageUrl: null,
        role: 'user' as const,
      };

      const user = await storage.upsertUser(userData);

      // Add to local newsletter database and Beehiiv
      try {
        const existingSubscriber = await storage.getEmailSubscriber(email);
        if (!existingSubscriber) {
          // Add to local database
          await storage.createEmailSubscriber({ 
            email: email
          });
        }
        
        // Always try to add to Beehiiv newsletter (handles duplicates gracefully)
        const beehiivResult = await addToBeehiivNewsletter(email);
        if (beehiivResult.success) {
          console.log('User successfully subscribed to Beehiiv newsletter:', email);
        } else {
          console.error(`Failed to add ${email} to Beehiiv:`, beehiivResult.error);
        }
      } catch (error) {
        console.log('Newsletter subscription error (non-fatal):', error);
      }

      // Set user session
      (req.session as any).user = {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName
      };
      
      await new Promise((resolve) => req.session.save(resolve));

      res.json({
        success: true,
        user: (req.session as any).user
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({ message: 'Signup failed' });
    }
  });

  // Email subscription endpoint
  app.post("/api/subscribe", async (req, res) => {
    try {
      const { email } = insertEmailSubscriberSchema.parse(req.body);
      
      // Check if already subscribed
      const existingSubscriber = await storage.getEmailSubscriber(email);
      if (existingSubscriber) {
        return res.json({ message: "Already subscribed to newsletter" });
      }

      // Add to local database
      await storage.createEmailSubscriber({ email });

      // Add to Beehiiv newsletter
      const beehiivResult = await addToBeehiivNewsletter(email);
      
      if (beehiivResult.success) {
        console.log('User successfully subscribed to Beehiiv newsletter:', email);
        res.json({ message: "Successfully subscribed to newsletter" });
      } else {
        console.error(`Failed to add ${email} to Beehiiv:`, beehiivResult.error);
        // Still return success since we saved locally
        res.json({ 
          message: "Subscribed locally, newsletter sync pending",
          warning: "External newsletter service temporarily unavailable"
        });
      }
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.toString() });
      }
      console.error("Subscription error:", error);
      res.status(500).json({ message: "Failed to subscribe" });
    }
  });

  // Get subscriber count
  app.get("/api/subscriber-count", async (req, res) => {
    try {
      const count = await storage.getEmailSubscribersCount();
      res.json({ count });
    } catch (error) {
      console.error("Error fetching subscriber count:", error);
      res.status(500).json({ message: "Failed to fetch subscriber count" });
    }
  });

  // Categories endpoints
  app.get("/api/categories", async (req, res) => {
    try {
      const parentId = req.query.parentId as string | undefined;
      const searchMetric = req.query.searchMetric as string | undefined;
      
      let categories = await storage.getCategoriesByParent(parentId || null);
      
      // For HPK data, return only the actual categories from HPK uploads
      if (searchMetric === 'high-potential') {
        categories = await storage.getCategoriesWithHpkData();
      }
      
      // For RK data, return only the actual categories from RK uploads
      if (searchMetric === 'rising') {
        categories = await storage.getCategoriesWithRkData();
      }
      
      res.json(categories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  // Categories with keyword counts - add caching headers
  app.get("/api/categories/with-counts", async (req, res) => {
    try {
      const { uploadPeriod, searchMetric } = req.query;
      
      // Set cache headers for categories (they don't change often)
      res.set({
        'Cache-Control': 'public, max-age=600, stale-while-revalidate=1800', // 10min cache, 30min stale
        'ETag': `categories-v4-${uploadPeriod || 'all'}-${searchMetric || 'regular'}`
      });
      
      const categories = await storage.getCategoriesWithKeywordCounts(
        uploadPeriod as string,
        searchMetric as string
      );
      
      // Get total unique keywords count (same logic as search API to ensure consistency)
      const totalUniqueKeywords = await storage.getTotalKeywordsCount(
        uploadPeriod as string,
        searchMetric as string
      );
      
      const response = {
        categories: categories,
        totalUniqueKeywords: totalUniqueKeywords
      };
      
      res.json(response);
    } catch (error) {
      console.error("Error fetching categories with counts:", error);
      res.status(500).json({ message: "Failed to fetch categories with counts" });
    }
  });

  // Keyword search endpoint
  app.get("/api/keywords/search", async (req, res) => {
    try {
      const { q, query, category, subCategory1, subCategory2, uploadPeriod, page, limit, sortFields, sortDirections, searchMetric } = req.query;
      const searchQuery = (q || query) as string;
      const uploadPeriodStr = uploadPeriod as string;
      const searchMetricStr = searchMetric as string || 'top';
      
      // Pagination parameters
      const pageNum = page ? parseInt(page as string) : 1;
      const pageSize = limit ? parseInt(limit as string) : 20; // Default to 20 per page
      const offset = (pageNum - 1) * pageSize;
      
      // Multi-column sorting parameters
      const sortFieldsStr = sortFields as string;
      const sortDirectionsStr = sortDirections as string;
      
      // Set appropriate cache headers based on query type
      const cacheSeconds = searchQuery ? 120 : 300; // 2min for search, 5min for category browse
      res.set({
        'Cache-Control': `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`,
        'Vary': 'Accept-Encoding' // Enable compression-aware caching
      });
      
      // Handle search requests - either keyword search or category browsing
      const result = await storage.searchKeywordsWithPagination(
        searchQuery || '', 
        category as string, 
        subCategory1 as string, 
        subCategory2 as string, 
        uploadPeriodStr,
        pageSize,
        offset,
        sortFieldsStr,
        sortDirectionsStr,
        searchMetricStr
      );

      // Track search activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        'search',
        {
          query: searchQuery,
          category,
          searchMetric: searchMetricStr,
          results: result.total,
          page: pageNum
        }
      );
      
      res.json({
        keywords: result.keywords,
        pagination: {
          page: pageNum,
          pageSize: pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / pageSize),
          hasNext: pageNum * pageSize < result.total,
          hasPrev: pageNum > 1
        }
      });
    } catch (error) {
      console.error("Error searching keywords:", error);
      res.status(500).json({ message: "Failed to search keywords" });
    }
  });

  // Admin categories endpoint
  app.get("/api/admin/categories", isAdmin, async (req, res) => {
    try {
      const categories = await storage.getCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching admin categories:", error);
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  // Admin keyword CRUD endpoints
  app.get("/api/admin/keywords", isAdmin, async (req, res) => {
    try {
      const { limit, search, categoryId, uploadPeriod } = req.query;
      const keywords = await storage.getKeywords(
        limit ? parseInt(limit as string) : undefined,
        search as string,
        categoryId as string,
        uploadPeriod as string
      );
      res.json(keywords);
    } catch (error) {
      console.error("Error fetching keywords:", error);
      res.status(500).json({ message: "Failed to fetch keywords" });
    }
  });

  app.post("/api/admin/keywords", isAdmin, async (req, res) => {
    try {
      const validatedData = insertKeywordSchema.parse(req.body);
      const keyword = await storage.createKeyword(validatedData);
      res.status(201).json(keyword);
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.toString() });
      }
      console.error("Error creating keyword:", error);
      res.status(500).json({ message: "Failed to create keyword" });
    }
  });

  app.put("/api/admin/keywords/:id", isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = updateKeywordSchema.parse(req.body);
      const keyword = await storage.updateKeyword(id, validatedData);
      res.json(keyword);
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.toString() });
      }
      console.error("Error updating keyword:", error);
      res.status(500).json({ message: "Failed to update keyword" });
    }
  });

  app.delete("/api/admin/keywords/:id", isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteKeyword(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting keyword:", error);
      res.status(500).json({ message: "Failed to delete keyword" });
    }
  });

  // CSV Upload endpoints removed - Add 410 Gone responses for backward compatibility
  app.post("/api/admin/keywords/upload-csv", isAdmin, (req, res) => {
    res.status(410).json({ 
      message: "CSV upload endpoint removed. Please upload CSV files directly to Supabase using the dashboard." 
    });
  });

  app.post("/api/admin/keywords/upload-hpk", isAdmin, (req, res) => {
    res.status(410).json({ 
      message: "HPK upload endpoint removed. Please upload HPK CSV files directly to Supabase using the dashboard." 
    });
  });

  app.post("/api/admin/keywords/upload-rk", isAdmin, (req, res) => {
    res.status(410).json({ 
      message: "RK upload endpoint removed. Please upload RK CSV files directly to Supabase using the dashboard." 
    });
  });

  // Period endpoints for compatibility
  app.get("/api/admin/uploads", isAdmin, async (req, res) => {
    try {
      res.json({ message: "Upload functionality removed. Use Supabase dashboard for CSV uploads." });
    } catch (error) {
      console.error("Error fetching uploads:", error);
      res.status(500).json({ message: "Failed to fetch uploads" });
    }
  });

  app.get("/api/keywords/hpk-periods", async (req, res) => {
    try {
      const periods = await storage.getHpkPeriods();
      res.json(periods);
    } catch (error) {
      console.error("Error fetching HPK periods:", error);
      res.status(500).json({ message: "Failed to fetch HPK periods" });
    }
  });

  app.get("/api/keywords/rk-periods", async (req, res) => {
    try {
      const periods = await storage.getRkPeriods();
      res.json(periods);
    } catch (error) {
      console.error("Error fetching RK periods:", error);
      res.status(500).json({ message: "Failed to fetch RK periods" });
    }
  });

  app.get("/api/keywords/regular-periods", async (req, res) => {
    try {
      const periods = await storage.getRegularPeriods();
      res.json(periods);
    } catch (error) {
      console.error("Error fetching regular periods:", error);
      res.status(500).json({ message: "Failed to fetch regular periods" });
    }
  });

  // Now I need to add the remaining large routes - Training materials, Ad management
  // Let me continue in the next edit to keep this manageable
  return createServer(app);
}