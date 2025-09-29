import {
  users,
  emailSubscribers,
  categories,
  keywords,
  userSessions,
  userActivities,
  type User,
  type UpsertUser,
  type EmailSubscriber,
  type InsertEmailSubscriber,
  type Category,
  type InsertCategory,
  type Keyword,
  type InsertKeyword,
  type UpdateKeyword,
  type UserSession,
  type InsertUserSession,
  type UserActivity,
  type InsertUserActivity,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, ilike, or, isNull, isNotNull, ne, sql } from "drizzle-orm";

export interface IStorage {
  // User operations for Replit Auth
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Email subscriber operations
  getEmailSubscriber(email: string): Promise<EmailSubscriber | undefined>;
  createEmailSubscriber(subscriber: InsertEmailSubscriber): Promise<EmailSubscriber>;
  getEmailSubscribersCount(): Promise<number>;
  getEmailSubscribers(): Promise<EmailSubscriber[]>;
  
  // Category operations
  getCategories(): Promise<Category[]>;
  getCategoriesByParent(parentId: string | null): Promise<Category[]>;
  getCategoriesWithKeywordCounts(): Promise<(Category & { keywordCount: number })[]>;
  getCategoriesWithHpkData(): Promise<Category[]>;
  createCategory(category: InsertCategory): Promise<Category>;
  
  // Keyword operations
  getKeywords(limit?: number, search?: string, categoryId?: string, uploadPeriod?: string): Promise<Keyword[]>;
  getKeywordById(id: string): Promise<Keyword | undefined>;
  createKeyword(keyword: InsertKeyword): Promise<Keyword>;
  updateKeyword(id: string, updates: UpdateKeyword): Promise<Keyword>;
  deleteKeyword(id: string): Promise<void>;
  searchKeywords(query: string, category?: string, subCategory1?: string, subCategory2?: string, uploadPeriod?: string): Promise<Keyword[]>;
  searchKeywordsWithPagination(query: string, category?: string, subCategory1?: string, subCategory2?: string, uploadPeriod?: string, limit?: number, offset?: number, sortFields?: string, sortDirections?: string, searchMetric?: string): Promise<{ keywords: Keyword[], total: number }>;
  
  // Upload management methods
  getUploadPeriods(): Promise<{ period: string, count: number, type: 'regular' | 'hpk' | 'rk' }[]>;
  deleteUploadPeriod(uploadPeriod: string, uploadType: 'regular' | 'hpk' | 'rk'): Promise<number>;
  getAvailableHpkPeriods(): Promise<{ value: string, label: string, type: 'week' }[]>;
  getAvailableRkPeriods(): Promise<{ value: string, label: string, type: 'month' }[]>;
  getAvailableRegularPeriods(): Promise<{ value: string, label: string, type: 'month' | 'week' }[]>;
  
  // User activity tracking methods
  createUserSession(session: InsertUserSession): Promise<UserSession>;
  updateUserSession(sessionId: string, updates: { endTime?: Date, isActive?: boolean }): Promise<UserSession>;
  createUserActivity(activity: InsertUserActivity): Promise<UserActivity>;
  getUserSessions(userId?: string, startDate?: Date, endDate?: Date): Promise<UserSession[]>;
  getUserActivities(userId?: string, startDate?: Date, endDate?: Date, activityType?: string): Promise<UserActivity[]>;
  
  // Usage statistics methods
  getDailyUsageStats(days?: number): Promise<{ date: string, sessions: number, uniqueUsers: number, activities: number, emails: string[] }[]>;
  getWeeklyUsageStats(weeks?: number): Promise<{ week: string, sessions: number, uniqueUsers: number, activities: number, emails: string[] }[]>;
  getMonthlyUsageStats(months?: number): Promise<{ month: string, sessions: number, uniqueUsers: number, activities: number, emails: string[] }[]>;
  getActivityBreakdown(startDate?: Date, endDate?: Date): Promise<{ activityType: string, count: number }[]>;
  
}

export class DatabaseStorage implements IStorage {
  // User operations for Replit Auth
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // Check if this is the first user - if so, make them admin
    const userCount = await db.select().from(users);
    const isFirstUser = userCount.length === 0;
    
    const userDataWithRole = {
      ...userData,
      role: isFirstUser ? ('admin' as const) : (userData.role || 'user' as const)
    };

    const [user] = await db
      .insert(users)
      .values(userDataWithRole)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userDataWithRole,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Email subscriber operations
  async getEmailSubscriber(email: string): Promise<EmailSubscriber | undefined> {
    const [subscriber] = await db
      .select()
      .from(emailSubscribers)
      .where(eq(emailSubscribers.email, email));
    return subscriber;
  }

  async createEmailSubscriber(subscriber: InsertEmailSubscriber): Promise<EmailSubscriber> {
    const [newSubscriber] = await db
      .insert(emailSubscribers)
      .values(subscriber)
      .returning();
    return newSubscriber;
  }

  async getEmailSubscribersCount(): Promise<number> {
    const result = await db
      .select()
      .from(emailSubscribers)
      .where(eq(emailSubscribers.status, 'active'));
    return result.length;
  }

  async getEmailSubscribers(): Promise<EmailSubscriber[]> {
    const result = await db
      .select()
      .from(emailSubscribers)
      .where(eq(emailSubscribers.status, 'active'))
      .orderBy(desc(emailSubscribers.subscribedAt));
    return result;
  }

  // Category operations
  async getCategories(): Promise<Category[]> {
    const result = await db.select().from(categories).orderBy(categories.name);
    return result as Category[];
  }

  async getCategoriesByParent(parentId: string | null): Promise<Category[]> {
    const result = await db
      .select()
      .from(categories)
      .where(parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId))
      .orderBy(categories.name);
    return result as Category[];
  }

  async getCategoriesWithKeywordCounts(
    uploadPeriod?: string,
    searchMetric?: string
  ): Promise<(Category & { keywordCount: number })[]> {
    // Build the hierarchical category structure more efficiently
    const categoryMap = new Map<string, Category & { keywordCount: number }>();
    
    // Build base conditions
    const baseConditions = [
      eq(keywords.isActive, true),
      isNotNull(keywords.category),
      ne(keywords.category, '')
    ];
    
    // Add period filter if specified
    if (uploadPeriod) {
      baseConditions.push(eq(keywords.uploadPeriod, uploadPeriod));
    }
    
    // Add search metric filter if specified
    if (searchMetric === 'high-potential') {
      baseConditions.push(eq(keywords.isHpk, true));
    } else if (searchMetric === 'rising') {
      baseConditions.push(eq(keywords.isRk, true));
    } else if (searchMetric === 'top') {
      // Regular keywords (not HPK and not RK)
      baseConditions.push(eq(keywords.isHpk, false));
      baseConditions.push(eq(keywords.isRk, false));
    }
    
    // First, get main category counts (using distinct keywords to match search deduplication)
    const mainCategoryCounts = await db
      .select({
        category: keywords.category,
        count: sql<number>`COUNT(DISTINCT keyword)::int`.as('count'),
      })
      .from(keywords)
      .where(and(...baseConditions))
      .groupBy(keywords.category);
    
    // Create main categories
    for (const item of mainCategoryCounts) {
      categoryMap.set(item.category!, {
        id: item.category!,
        name: item.category!,
        parentId: null,
        createdAt: new Date(),
        keywordCount: Number(item.count)
      });
    }
    
    // Get subcategory counts with same filters
    const subCategory1Conditions = [
      ...baseConditions,
      isNotNull(keywords.subCategory1),
      ne(keywords.subCategory1, '')
    ];
    
    const subCategory1Counts = await db
      .select({
        category: keywords.category,
        subCategory1: keywords.subCategory1,
        count: sql<number>`COUNT(DISTINCT keyword)::int`.as('count'),
      })
      .from(keywords)
      .where(and(...subCategory1Conditions))
      .groupBy(keywords.category, keywords.subCategory1);
    
    // Create subcategories
    for (const item of subCategory1Counts) {
      const subCat1Key = `${item.category}::${item.subCategory1}`;
      categoryMap.set(subCat1Key, {
        id: subCat1Key,
        name: item.subCategory1!,
        parentId: item.category!,
        createdAt: new Date(),
        keywordCount: Number(item.count)
      });
    }
    
    // Get sub-subcategory counts with same filters
    const subCategory2Conditions = [
      ...baseConditions,
      isNotNull(keywords.subCategory1),
      ne(keywords.subCategory1, ''),
      isNotNull(keywords.subCategory2),
      ne(keywords.subCategory2, '')
    ];
    
    const subCategory2Counts = await db
      .select({
        category: keywords.category,
        subCategory1: keywords.subCategory1,
        subCategory2: keywords.subCategory2,
        count: sql<number>`COUNT(DISTINCT keyword)::int`.as('count'),
      })
      .from(keywords)
      .where(and(...subCategory2Conditions))
      .groupBy(keywords.category, keywords.subCategory1, keywords.subCategory2);
    
    // Create sub-subcategories
    for (const item of subCategory2Counts) {
      const subCat2Key = `${item.category}::${item.subCategory1}::${item.subCategory2}`;
      const parentKey = `${item.category}::${item.subCategory1}`;
      
      categoryMap.set(subCat2Key, {
        id: subCat2Key,
        name: item.subCategory2!,
        parentId: parentKey,
        createdAt: new Date(),
        keywordCount: Number(item.count)
      });
    }
    
    // Convert map to array and sort
    const result = Array.from(categoryMap.values());
    return result.sort((a, b) => {
      // Sort by hierarchy level first (main categories first), then by keyword count
      const aLevel = (a.parentId ? (a.parentId.includes('::') ? 2 : 1) : 0);
      const bLevel = (b.parentId ? (b.parentId.includes('::') ? 2 : 1) : 0);
      
      if (aLevel !== bLevel) return aLevel - bLevel;
      return b.keywordCount - a.keywordCount;
    });
  }

  async getCategoriesWithHpkData(): Promise<(Category & { keywordCount: number })[]> {
    // Get categories from HPK upload data with unique keyword counts (matching search deduplication logic)
    const categoriesWithHpk = await db
      .select({
        category: keywords.category,
        count: sql<number>`COUNT(DISTINCT keyword)::int`
      })
      .from(keywords)
      .where(and(
        eq(keywords.isHpk, true),
        eq(keywords.isActive, true),
        isNotNull(keywords.category),
        ne(keywords.category, '')
      ))
      .groupBy(keywords.category)
      .orderBy(keywords.category);
    
    // Convert to Category format with actual unique HPK keyword counts
    return categoriesWithHpk.map(item => ({
      id: item.category!,
      name: item.category!,
      parentId: null,
      keywordCount: item.count,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
  }

  async getCategoriesWithRkData(): Promise<(Category & { keywordCount: number })[]> {
    // Get categories from RK upload data with unique keyword counts (matching search deduplication logic)
    const categoriesWithRk = await db
      .select({
        category: keywords.category,
        count: sql<number>`COUNT(DISTINCT keyword)::int`
      })
      .from(keywords)
      .where(and(
        eq(keywords.isRk, true),
        eq(keywords.isActive, true),
        isNotNull(keywords.category),
        ne(keywords.category, '')
      ))
      .groupBy(keywords.category)
      .orderBy(keywords.category);
    
    // Convert to Category format with actual unique RK keyword counts
    return categoriesWithRk.map(item => ({
      id: item.category!,
      name: item.category!,
      parentId: null,
      keywordCount: item.count,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
  }

  async createCategory(category: InsertCategory): Promise<Category> {
    const [newCategory] = await db
      .insert(categories)
      .values(category)
      .returning();
    return newCategory;
  }

  // Keyword operations
  async getKeywords(limit = 50, search?: string, categoryId?: string, uploadPeriod?: string): Promise<Keyword[]> {
    let conditions = [eq(keywords.isActive, true)];

    if (search) {
      conditions.push(ilike(keywords.keyword, `%${search}%`));
    }

    if (categoryId) {
      conditions.push(eq(keywords.categoryId, categoryId));
    }

    if (uploadPeriod) {
      conditions.push(eq(keywords.uploadPeriod, uploadPeriod));
    }

    const result = await db
      .select()
      .from(keywords)
      .where(and(...conditions))
      .orderBy(desc(keywords.searchVolume))
      .limit(limit);
    
    return result;
  }

  async getKeywordById(id: string): Promise<Keyword | undefined> {
    const [keyword] = await db
      .select()
      .from(keywords)
      .where(eq(keywords.id, id));
    return keyword;
  }

  async createKeyword(keyword: InsertKeyword): Promise<Keyword> {
    const [newKeyword] = await db
      .insert(keywords)
      .values(keyword)
      .returning();
    return newKeyword;
  }

  async createKeywordsBatch(keywordDataArray: InsertKeyword[]): Promise<Keyword[]> {
    if (keywordDataArray.length === 0) return [];
    
    const insertedKeywords = await db
      .insert(keywords)
      .values(keywordDataArray)
      .returning();
    return insertedKeywords;
  }

  async updateKeyword(id: string, updates: UpdateKeyword): Promise<Keyword> {
    const [updatedKeyword] = await db
      .update(keywords)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(keywords.id, id))
      .returning();
    return updatedKeyword;
  }

  async deleteKeyword(id: string): Promise<void> {
    await db
      .update(keywords)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(keywords.id, id));
  }

  async searchKeywords(query: string, category?: string, subCategory1?: string, subCategory2?: string, uploadPeriod?: string): Promise<Keyword[]> {
    let conditions = [eq(keywords.isActive, true)];

    // Add query filter if provided
    if (query && query.trim()) {
      conditions.push(ilike(keywords.keyword, `%${query}%`));
    }

    // Add category filters if provided (hierarchical filtering)
    if (category && category.trim()) {
      conditions.push(eq(keywords.category, category));
    }
    
    if (subCategory1 && subCategory1.trim()) {
      conditions.push(eq(keywords.subCategory1, subCategory1));
    }
    
    if (subCategory2 && subCategory2.trim()) {
      conditions.push(eq(keywords.subCategory2, subCategory2));
    }

    // Add upload period filter if provided
    if (uploadPeriod) {
      conditions.push(eq(keywords.uploadPeriod, uploadPeriod));
    }

    // Get all matching keywords first, then deduplicate in memory
    const allResults = await db
      .select()
      .from(keywords)
      .where(and(...conditions))
      .orderBy(desc(keywords.searchVolume));

    // Remove duplicates by keyword, keeping the one with highest search volume
    const seenKeywords = new Set<string>();
    const uniqueResults = allResults.filter(keyword => {
      if (seenKeywords.has(keyword.keyword)) {
        return false;
      }
      seenKeywords.add(keyword.keyword);
      return true;
    });

    // Return top 100 unique results
    return uniqueResults.slice(0, 100);
  }

  async searchKeywordsWithPagination(query: string, category?: string, subCategory1?: string, subCategory2?: string, uploadPeriod?: string, limit = 20, offset = 0, sortFields?: string, sortDirections?: string, searchMetric?: string): Promise<{ keywords: Keyword[], total: number }> {
    // DEBUG: Log filtering parameters
    console.log("Storage - searchKeywordsWithPagination called with:", {
      query,
      category,
      subCategory1,
      subCategory2,
      uploadPeriod,
      limit,
      offset
    });

    // Build optimized query conditions
    let conditions = [eq(keywords.isActive, true)];

    // Add query filter if provided
    if (query && query.trim()) {
      conditions.push(ilike(keywords.keyword, `%${query}%`));
    }

    // Add category filters if provided (hierarchical filtering)
    if (category && category.trim()) {
      conditions.push(eq(keywords.category, category));
    }
    
    if (subCategory1 && subCategory1.trim()) {
      conditions.push(eq(keywords.subCategory1, subCategory1));
    }
    
    if (subCategory2 && subCategory2.trim()) {
      conditions.push(eq(keywords.subCategory2, subCategory2));
    }

    // Add upload period filter if provided
    if (uploadPeriod) {
      console.log("Storage - Adding upload period filter:", uploadPeriod);
      conditions.push(eq(keywords.uploadPeriod, uploadPeriod));
    } else {
      console.log("Storage - No upload period filter applied");
    }

    // Add search metric filters
    if (searchMetric === 'high-potential') {
      console.log("Storage - Adding HPK filter: isHpk = true");
      conditions.push(eq(keywords.isHpk, true));
    } else if (searchMetric === 'rising') {
      console.log("Storage - Adding RK filter: isRk = true");
      conditions.push(eq(keywords.isRk, true));
    } else {
      // For regular keywords (top search), exclude both HPK and RK
      console.log("Storage - Adding regular keywords filter: exclude HPK and RK");
      conditions.push(eq(keywords.isHpk, false));
      conditions.push(eq(keywords.isRk, false));
    }

    // Use optimized approach: distinct on keyword, order by search volume descending
    // This avoids loading all data into memory for deduplication
    const distinctQuery = sql`
      SELECT DISTINCT ON (${keywords.keyword}) *
      FROM ${keywords}
      WHERE ${and(...conditions)}
      ORDER BY ${keywords.keyword}, ${keywords.searchVolume} DESC
    `;

    // Get total count efficiently
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM (
        SELECT DISTINCT ${keywords.keyword}
        FROM ${keywords}
        WHERE ${and(...conditions)}
      ) as unique_keywords
    `);
    
    const total = Number(countResult.rows[0]?.count || 0);

    // Parse multi-column sorting
    const parseSortCriteria = (fields?: string, directions?: string) => {
      if (!fields || !directions) return [{ column: 'search_volume', direction: 'DESC' }];
      
      const fieldArray = fields.split(',');
      const directionArray = directions.split(',');
      
      return fieldArray.map((field, index) => {
        const direction = directionArray[index]?.toUpperCase() || 'DESC';
        const column = getSortColumn(field.trim());
        return { column, direction };
      });
    };

    // Map sorting field to database column
    const getSortColumn = (field: string) => {
      switch (field) {
        case 'keyword': return 'keyword';
        case 'rank': return 'rank';
        case 'searchVolume': return 'search_volume';
        case 'productClickScore': return 'product_click_score';
        case 'skuSalesScore': return 'sku_sales_score';
        case 'availableProducts': return 'available_products';
        case 'averagePrice': return 'average_price';
        case 'ctrScore': return 'ctr_score';
        case 'ctorScore': return 'ctor_score';
        default: return 'search_volume'; // Default to search volume
      }
    };

    // Apply search metric-based sorting if no custom sorting is provided
    let defaultSortCriteria;
    if (!sortFields && searchMetric) {
      switch (searchMetric) {
        case 'top':
          // Top search keywords: sorted by search volume (highest first)
          defaultSortCriteria = [{ column: 'search_volume', direction: 'DESC' }];
          break;
        case 'rising':
          // Rising keywords: sorted by CTR score (engagement potential)
          defaultSortCriteria = [{ column: 'ctr_score', direction: 'DESC' }];
          break;
        case 'high-potential':
          // High-potential keywords: sorted by SKU sales score
          defaultSortCriteria = [{ column: 'sku_sales_score', direction: 'DESC' }];
          break;
        default:
          defaultSortCriteria = [{ column: 'search_volume', direction: 'DESC' }];
      }
    }

    const sortCriteria = sortFields ? parseSortCriteria(sortFields, sortDirections) : defaultSortCriteria || [{ column: 'search_volume', direction: 'DESC' }];

    // Build dynamic ORDER BY clause with proper numeric casting
    const orderByClause = sortCriteria
      .map(({ column, direction }) => {
        // Cast numeric columns to proper type for sorting
        if (['ctr_score', 'sku_sales_score', 'product_click_score', 'average_price', 'ctor_score'].includes(column)) {
          return `CAST(${column} AS NUMERIC) ${direction} NULLS LAST`;
        } else if (['search_volume', 'available_products'].includes(column)) {
          return `${column} ${direction}`;
        } else {
          return `${column} ${direction}`;
        }
      })
      .join(', ');

    // Get paginated results with multi-column sorting
    const paginatedQuery = sql`
      SELECT * FROM (
        ${distinctQuery}
      ) as distinct_keywords
      ORDER BY ${sql.raw(orderByClause)}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const result = await db.execute(paginatedQuery);
    
    // Map raw results to proper keyword objects
    const mappedResults: Keyword[] = result.rows.map(row => ({
      id: row.id as string,
      keyword: row.keyword as string,
      rank: row.rank as number | null,
      searchVolume: row.search_volume as number,
      productClickScore: row.product_click_score as string,
      skuSalesScore: row.sku_sales_score as string | null,
      availableProducts: row.available_products as number,
      averagePrice: row.average_price as string,
      ctrScore: row.ctr_score as string,
      ctorScore: row.ctor_score as string,
      categoryId: row.category_id as string | null,
      category: row.category as string | null,
      subCategory1: row.sub_category_1 as string | null,
      subCategory2: row.sub_category_2 as string | null,
      uploadPeriod: row.upload_period as string | null,
      startDate: row.start_date as string | null,
      endDate: row.end_date as string | null,
      isActive: row.is_active as boolean,
      isHpk: row.is_hpk as boolean,
      isRk: row.is_rk as boolean,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    }));

    return {
      keywords: mappedResults,
      total: total
    };
  }

  // Upload management methods
  async getUploadPeriods(): Promise<{ period: string, count: number, type: 'regular' | 'hpk' | 'rk' }[]> {
    // Get regular keyword uploads
    const regularUploads = await db
      .select({
        uploadPeriod: keywords.uploadPeriod,
        count: sql<number>`COUNT(DISTINCT ${keywords.keyword})`.as('count'),
      })
      .from(keywords)
      .where(and(
        eq(keywords.isActive, true),
        eq(keywords.isHpk, false),
        eq(keywords.isRk, false),
        isNotNull(keywords.uploadPeriod)
      ))
      .groupBy(keywords.uploadPeriod)
      .orderBy(desc(keywords.uploadPeriod));

    // Get HPK uploads
    const hpkUploads = await db
      .select({
        uploadPeriod: keywords.uploadPeriod,
        count: sql<number>`COUNT(DISTINCT ${keywords.keyword})`.as('count'),
      })
      .from(keywords)
      .where(and(
        eq(keywords.isActive, true),
        eq(keywords.isHpk, true),
        isNotNull(keywords.uploadPeriod)
      ))
      .groupBy(keywords.uploadPeriod)
      .orderBy(desc(keywords.uploadPeriod));

    // Get RK uploads
    const rkUploads = await db
      .select({
        uploadPeriod: keywords.uploadPeriod,
        count: sql<number>`COUNT(DISTINCT ${keywords.keyword})`.as('count'),
      })
      .from(keywords)
      .where(and(
        eq(keywords.isActive, true),
        eq(keywords.isRk, true),
        isNotNull(keywords.uploadPeriod)
      ))
      .groupBy(keywords.uploadPeriod)
      .orderBy(desc(keywords.uploadPeriod));

    // Combine and format results
    const allUploads = [
      ...regularUploads.map(u => ({ period: u.uploadPeriod!, count: u.count, type: 'regular' as const })),
      ...hpkUploads.map(u => ({ period: u.uploadPeriod!, count: u.count, type: 'hpk' as const })),
      ...rkUploads.map(u => ({ period: u.uploadPeriod!, count: u.count, type: 'rk' as const }))
    ];

    return allUploads.sort((a, b) => b.period.localeCompare(a.period));
  }

  async getAvailableHpkPeriods(): Promise<{ value: string, label: string, type: 'week' }[]> {
    // Get all distinct HPK upload periods
    const hpkPeriods = await db
      .select({
        uploadPeriod: keywords.uploadPeriod,
      })
      .from(keywords)
      .where(and(
        eq(keywords.isActive, true),
        eq(keywords.isHpk, true),
        isNotNull(keywords.uploadPeriod)
      ))
      .groupBy(keywords.uploadPeriod)
      .orderBy(desc(keywords.uploadPeriod));

    // Convert periods to weekly format for frontend
    return hpkPeriods.map(p => {
      const uploadPeriod = p.uploadPeriod!;
      
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      
      // Handle YYYYMMDD format (like "20250526")
      if (uploadPeriod.length === 8 && /^\d{8}$/.test(uploadPeriod)) {
        const year = uploadPeriod.substring(0, 4);
        const month = uploadPeriod.substring(4, 6);
        const day = uploadPeriod.substring(6, 8);
        const monthName = monthNames[parseInt(month) - 1];
        
        return {
          value: uploadPeriod,
          label: `Week starting ${monthName} ${parseInt(day)}, ${year}`,
          type: 'week' as const
        };
      }
      // Handle weekly format (YYYY-MM-DD)
      else if (uploadPeriod.includes('-') && uploadPeriod.length > 7) {
        const [year, month, day] = uploadPeriod.split('-');
        const monthName = monthNames[parseInt(month) - 1];
        
        return {
          value: uploadPeriod,
          label: `Week starting ${monthName} ${parseInt(day)}, ${year}`,
          type: 'week' as const
        };
      }
      // Handle legacy monthly format (YYYY-MM)
      else if (uploadPeriod.includes('-') && uploadPeriod.length <= 7) {
        const [year, month] = uploadPeriod.split('-');
        const monthName = monthNames[parseInt(month) - 1];
        
        return {
          value: uploadPeriod,
          label: `${monthName} ${year} (Weekly Data)`,
          type: 'week' as const
        };
      }
      // Fallback for any other format
      else {
        return {
          value: uploadPeriod,
          label: `Week ${uploadPeriod}`,
          type: 'week' as const
        };
      }
    });
  }

  async getAvailableRkPeriods(): Promise<{ value: string, label: string, type: 'month' }[]> {
    // Get all distinct RK upload periods with counts
    const rkPeriods = await db
      .select({
        uploadPeriod: keywords.uploadPeriod,
        count: sql<number>`COUNT(DISTINCT ${keywords.keyword})`.as('count'),
      })
      .from(keywords)
      .where(and(
        eq(keywords.isActive, true),
        eq(keywords.isRk, true),
        isNotNull(keywords.uploadPeriod)
      ))
      .groupBy(keywords.uploadPeriod)
      .orderBy(desc(keywords.uploadPeriod));

    // Convert periods to the format expected by frontend (RK uses monthly format)
    return rkPeriods.map(p => {
      const uploadPeriod = p.uploadPeriod!;
      
      // Handle RK format: "RK-YYYYMM" 
      if (uploadPeriod.startsWith('RK-')) {
        const yyyymm = uploadPeriod.replace('RK-', '');
        const year = yyyymm.substring(0, 4);
        const month = yyyymm.substring(4, 6);
        
        const monthNames = [
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const monthName = monthNames[parseInt(month) - 1];
        
        return {
          value: uploadPeriod,
          label: `${monthName} ${year} (${p.count.toLocaleString()} keywords)`,
          type: 'month' as const
        };
      }
      
      // Handle different formats
      let year: string, month: string, monthName: string;
      
      if (uploadPeriod.includes('-')) {
        // Format: "YYYY-MM"
        [year, month] = uploadPeriod.split('-');
      } else if (uploadPeriod.length === 6 && /^\d{6}$/.test(uploadPeriod)) {
        // Format: "YYYYMM"
        year = uploadPeriod.substring(0, 4);
        month = uploadPeriod.substring(4, 6);
      } else {
        // Fallback
        return {
          value: uploadPeriod,
          label: `${uploadPeriod} (${p.count.toLocaleString()} keywords)`,
          type: 'month' as const
        };
      }
      
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      monthName = monthNames[parseInt(month) - 1];
      
      return {
        value: uploadPeriod,
        label: `${monthName} ${year} (${p.count.toLocaleString()} keywords)`,
        type: 'month' as const
      };
    });
  }

  async getAvailableRegularPeriods(): Promise<{ value: string, label: string, type: 'month' | 'week' }[]> {
    // Get all distinct regular keyword upload periods
    const regularPeriods = await db
      .select({
        uploadPeriod: keywords.uploadPeriod,
      })
      .from(keywords)
      .where(and(
        eq(keywords.isActive, true),
        eq(keywords.isHpk, false),
        eq(keywords.isRk, false),
        isNotNull(keywords.uploadPeriod)
      ))
      .groupBy(keywords.uploadPeriod)
      .orderBy(desc(keywords.uploadPeriod));

    // Convert periods to the format expected by frontend
    return regularPeriods.map(p => this.formatPeriodForFrontend(p.uploadPeriod!));
  }

  private formatPeriodForFrontend(uploadPeriod: string): { value: string, label: string, type: 'month' | 'week' } {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // For regular keywords, check if this represents actual weekly data or just monthly data with a day
    // Most regular keyword data is monthly, so default to monthly display unless it's truly weekly
    const [year, month, day] = uploadPeriod.split('-');
    const monthName = monthNames[parseInt(month) - 1];
    
    // If day is "01" (first of month), this is likely monthly data, show as month
    if (day === '01' || !day) {
      return {
        value: uploadPeriod,
        label: `${monthName} ${year}`,
        type: 'month' as const
      };
    } else {
      // If it's not the 1st of the month, this is actual weekly data
      return {
        value: uploadPeriod,
        label: `Week of ${monthName} ${day}, ${year}`,
        type: 'week' as const
      };
    }
  }

  async deleteUploadPeriod(uploadPeriod: string, uploadType: 'regular' | 'hpk' | 'rk'): Promise<number> {
    let conditions = [
      eq(keywords.uploadPeriod, uploadPeriod),
      eq(keywords.isActive, true)
    ];

    // Add type-specific conditions
    if (uploadType === 'hpk') {
      conditions.push(eq(keywords.isHpk, true));
    } else if (uploadType === 'rk') {
      conditions.push(eq(keywords.isRk, true));
    } else {
      // Regular keywords (not HPK and not RK)
      conditions.push(eq(keywords.isHpk, false));
      conditions.push(eq(keywords.isRk, false));
    }

    const result = await db
      .update(keywords)
      .set({ 
        isActive: false, 
        updatedAt: new Date() 
      })
      .where(and(...conditions))
      .returning({ id: keywords.id });

    return result.length;
  }

  // Get total unique keywords count (same logic as search API for consistency)
  async getTotalKeywordsCount(uploadPeriod?: string, searchMetric?: string): Promise<number> {
    // Build conditions exactly like searchKeywordsWithPagination method
    let conditions = [eq(keywords.isActive, true)];

    // Add upload period filter if provided
    if (uploadPeriod) {
      conditions.push(eq(keywords.uploadPeriod, uploadPeriod));
    }

    // Add search metric filters - exact same logic as search API
    if (searchMetric === 'high-potential') {
      conditions.push(eq(keywords.isHpk, true));
    } else if (searchMetric === 'rising') {
      conditions.push(eq(keywords.isRk, true));
    } else {
      // For regular keywords (top search), exclude both HPK and RK
      conditions.push(eq(keywords.isHpk, false));
      conditions.push(eq(keywords.isRk, false));
    }

    // Count unique keywords - exact same logic as search API
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM (
        SELECT DISTINCT ${keywords.keyword}
        FROM ${keywords}
        WHERE ${and(...conditions)}
      ) as unique_keywords
    `);
    
    return Number(countResult.rows[0]?.count || 0);
  }

  // User activity tracking methods
  async createUserSession(session: InsertUserSession): Promise<UserSession> {
    const [newSession] = await db
      .insert(userSessions)
      .values(session)
      .returning();
    return newSession;
  }

  async updateUserSession(sessionId: string, updates: { endTime?: Date, isActive?: boolean }): Promise<UserSession> {
    const [updatedSession] = await db
      .update(userSessions)
      .set(updates)
      .where(eq(userSessions.id, sessionId))
      .returning();
    return updatedSession;
  }

  async createUserActivity(activity: InsertUserActivity): Promise<UserActivity> {
    const [newActivity] = await db
      .insert(userActivities)
      .values(activity)
      .returning();
    return newActivity;
  }

  async getUserSessions(userId?: string, startDate?: Date, endDate?: Date): Promise<UserSession[]> {
    let conditions = [];
    if (userId) conditions.push(eq(userSessions.userId, userId));
    if (startDate) conditions.push(sql`${userSessions.startTime} >= ${startDate}`);
    if (endDate) conditions.push(sql`${userSessions.startTime} <= ${endDate}`);

    const result = await db
      .select()
      .from(userSessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(userSessions.startTime));
    
    return result;
  }

  async getUserActivities(userId?: string, startDate?: Date, endDate?: Date, activityType?: string): Promise<UserActivity[]> {
    let conditions = [];
    if (userId) conditions.push(eq(userActivities.userId, userId));
    if (startDate) conditions.push(sql`${userActivities.timestamp} >= ${startDate}`);
    if (endDate) conditions.push(sql`${userActivities.timestamp} <= ${endDate}`);
    if (activityType) conditions.push(eq(userActivities.activityType, activityType));

    const result = await db
      .select()
      .from(userActivities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(userActivities.timestamp));
    
    return result;
  }

  // Usage statistics methods
  async getDailyUsageStats(days: number = 30): Promise<{ date: string, sessions: number, uniqueUsers: number, activities: number, emails: string[] }[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const sessionStats = await db.execute(sql`
      SELECT 
        DATE(start_time) as date,
        COUNT(*) as sessions,
        COUNT(DISTINCT user_id) as unique_users,
        ARRAY_AGG(DISTINCT u.email) FILTER (WHERE u.email IS NOT NULL) as emails
      FROM user_sessions us
      LEFT JOIN users u ON us.user_id = u.id
      WHERE start_time >= ${startDate}
      GROUP BY DATE(start_time)
      ORDER BY date DESC
    `);

    const activityStats = await db.execute(sql`
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as activities
      FROM user_activities
      WHERE timestamp >= ${startDate}
      GROUP BY DATE(timestamp)
    `);

    const activityMap = new Map(activityStats.rows.map(row => [row.date as string, Number(row.activities)]));

    return sessionStats.rows.map(row => ({
      date: row.date as string,
      sessions: Number(row.sessions),
      uniqueUsers: Number(row.unique_users),
      activities: activityMap.get(row.date as string) || 0,
      emails: (row.emails as string[]) || []
    }));
  }

  async getWeeklyUsageStats(weeks: number = 12): Promise<{ week: string, sessions: number, uniqueUsers: number, activities: number, emails: string[] }[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (weeks * 7));

    const sessionStats = await db.execute(sql`
      SELECT 
        TO_CHAR(DATE_TRUNC('week', start_time), 'YYYY-MM-DD') as week,
        COUNT(*) as sessions,
        COUNT(DISTINCT user_id) as unique_users,
        ARRAY_AGG(DISTINCT u.email) FILTER (WHERE u.email IS NOT NULL) as emails
      FROM user_sessions us
      LEFT JOIN users u ON us.user_id = u.id
      WHERE start_time >= ${startDate}
      GROUP BY DATE_TRUNC('week', start_time)
      ORDER BY week DESC
    `);

    const activityStats = await db.execute(sql`
      SELECT 
        TO_CHAR(DATE_TRUNC('week', timestamp), 'YYYY-MM-DD') as week,
        COUNT(*) as activities
      FROM user_activities
      WHERE timestamp >= ${startDate}
      GROUP BY DATE_TRUNC('week', timestamp)
    `);

    const activityMap = new Map(activityStats.rows.map(row => [row.week as string, Number(row.activities)]));

    return sessionStats.rows.map(row => ({
      week: row.week as string,
      sessions: Number(row.sessions),
      uniqueUsers: Number(row.unique_users),
      activities: activityMap.get(row.week as string) || 0,
      emails: (row.emails as string[]) || []
    }));
  }

  async getMonthlyUsageStats(months: number = 12): Promise<{ month: string, sessions: number, uniqueUsers: number, activities: number, emails: string[] }[]> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const sessionStats = await db.execute(sql`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', start_time), 'YYYY-MM') as month,
        COUNT(*) as sessions,
        COUNT(DISTINCT user_id) as unique_users,
        ARRAY_AGG(DISTINCT u.email) FILTER (WHERE u.email IS NOT NULL) as emails
      FROM user_sessions us
      LEFT JOIN users u ON us.user_id = u.id
      WHERE start_time >= ${startDate}
      GROUP BY DATE_TRUNC('month', start_time)
      ORDER BY month DESC
    `);

    const activityStats = await db.execute(sql`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', timestamp), 'YYYY-MM') as month,
        COUNT(*) as activities
      FROM user_activities
      WHERE timestamp >= ${startDate}
      GROUP BY DATE_TRUNC('month', timestamp)
    `);

    const activityMap = new Map(activityStats.rows.map(row => [row.month as string, Number(row.activities)]));

    return sessionStats.rows.map(row => ({
      month: row.month as string,
      sessions: Number(row.sessions),
      uniqueUsers: Number(row.unique_users),
      activities: activityMap.get(row.month as string) || 0,
      emails: (row.emails as string[]) || []
    }));
  }

  async getActivityBreakdown(startDate?: Date, endDate?: Date): Promise<{ activityType: string, count: number }[]> {
    let conditions = [];
    if (startDate) conditions.push(sql`${userActivities.timestamp} >= ${startDate}`);
    if (endDate) conditions.push(sql`${userActivities.timestamp} <= ${endDate}`);

    const result = await db
      .select({
        activityType: userActivities.activityType,
        count: sql`COUNT(*)`.as('count')
      })
      .from(userActivities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(userActivities.activityType)
      .orderBy(sql`COUNT(*) DESC`);

    return result.map(row => ({
      activityType: row.activityType,
      count: Number(row.count)
    }));
  }
}

export const storage = new DatabaseStorage();
