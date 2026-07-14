import React, { useState, useEffect } from "react";
import axios from "axios";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import "./App.css";
import Sidebar from "./Sidebar.js";
import "bootstrap/dist/css/bootstrap.min.css";
import { Dashboard as MoreVertIcon } from "@mui/icons-material";
import { Button } from "react-bootstrap";
import SearchIcon from "@mui/icons-material/Search";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import { CartStorage } from "./CartStorage";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ImageCache from "./utils/ImageCache";
import Footer from "./Footer.js";
// import { appConfig } from "./config";

// const normalizeName = (s) =>
//   String(s || "")
//     .toLowerCase()
//     .replace(/\s+/g, " ")
//     .trim();

const getLimit = (product) => {
  if (!product) return Infinity;
  const apiLimit = Number(product.limit);
  if (Number.isFinite(apiLimit) && apiLimit > 0) {
    return apiLimit;
  }
  return Infinity;
};

const clampQtyFor = (product, qty) => {
  const n = Math.max(0, Number(qty) || 0);
  const limit = getLimit(product);
  const stock = Number(product?.stockLeft || 0);
  return Math.min(n, limit, stock);
};

const INITIAL_IMAGE_COUNT = 12;
const IMAGE_FETCH_CONCURRENCY = 4;
const INITIAL_VISIBLE_PRODUCTS = 8;
const PRODUCT_REVEAL_STEP = 6;
const PRODUCT_REVEAL_DELAY = 110;
const OFFER_SKELETON_COUNT = 8;

const loadOfferImage = async ({ productId, photo, signal }) => {
  if (!photo) return null;

  const blobUrl = ImageCache.getBlobUrl(photo);
  if (blobUrl) {
    return { productId, dataUrl: blobUrl };
  }

  const cached = await ImageCache.getBase64(photo);
  if (cached) {
    return {
      productId,
      dataUrl: ImageCache.getOrCreateObjectUrl(photo, cached),
    };
  }

  const res = await fetch(
    `https://lmartapiv1-fxcyd2b4btacgsav.westus2-01.azurewebsites.net/api/FileUpload/download?generatedfilename=${encodeURIComponent(photo)}`,
    { signal },
  );
  const json = await res.json();
  const b64 = json?.imageData || "";
  if (!b64) return null;

  await ImageCache.setBase64(photo, b64);
  return {
    productId,
    dataUrl: ImageCache.getOrCreateObjectUrl(photo, b64),
  };
};

const hydrateOfferImages = async ({ items, signal, onResolved, concurrency = IMAGE_FETCH_CONCURRENCY }) => {
  const queue = Array.isArray(items) ? [...items] : [];
  const workerCount = Math.min(concurrency, queue.length);

  if (!workerCount) return;

  const worker = async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next || signal?.aborted) return;

      try {
        const resolved = await loadOfferImage({ ...next, signal });
        if (resolved && !signal?.aborted) {
          onResolved?.(resolved);
        }
      } catch (err) {
        if (err?.name !== "AbortError" && err?.name !== "CanceledError") {
          console.error("offer image hydrate failed:", err);
        }
      }
    }
  };

  await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
};

const GroceryOfferItems = () => {
  const navigate = useNavigate();
  const { userType, userId, selectedUserType } = useParams();
  const [isMobile, setIsMobile] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [products, setProducts] = useState([]);
  const [imageUrls, setImageUrls] = useState({});
  const [imageLoading, setImageLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_PRODUCTS);
  // const [showZoomModal, setShowZoomModal] = useState(false);
  // const [zoomImage, setZoomImage] = useState("");
  const [cart, setCart] = useState({});
  const [checked, setChecked] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [likedProducts, setLikedProducts] = useState({});
  // const [zoomProduct, setZoomProduct] = useState(null);
  const [grandSummary, setGrandSummary] = useState({ items: 0, total: 0 });
  const location = useLocation();
  const mobileNumber = localStorage.getItem("customerMobileNumber");
  console.log("Mobile Number from localStorage:", mobileNumber);

  const getInitialCategory = () => {
    const encodedFromState = location?.state?.encodedCategory;
    if (encodedFromState) {
      try {
        return decodeURIComponent(encodedFromState);
      } catch {
        return encodedFromState;
      }
    }
    const stored = localStorage.getItem("encodedCategory");
    if (stored) {
      try {
        return decodeURIComponent(stored);
      } catch {
        return stored;
      }
    }
    return "Offers";
  };

  const [selectedCategory] = useState(getInitialCategory);

  useEffect(() => {
    console.log(imageLoading, checked, grandSummary);
  }, [imageLoading, checked, grandSummary]);

  // const MIN_ORDER_TOTAL =
  //   normalizeName(selectedCategory) === normalizeName("Unbeatable Offers")
  //     ? 100
  //     : 100;
  const OFFERS = "Offers";
  const encodedCategory = OFFERS;

  useEffect(() => {
    const saved = CartStorage.getAll() || [];
    const categories = Array.isArray(saved) ? saved : [saved];
    const exist = categories.find((c) => c.categoryName === selectedCategory);
    if (exist) {
      const restored = {};
      (exist.products || []).forEach((p) => {
        restored[String(p.productId)] = Number(p.qty);
      });
      setCart(restored);
    }
  }, [selectedCategory]);

  useEffect(() => {
    if (!selectedCategory) return;
    const current = Object.entries(cart).map(([productId, qty]) => {
      const product = products.find((p) => String(p.id) === String(productId));
      return {
        productId,
        productName: product?.name || "",
        qty: Number(qty),
        mrp: Number(product?.mrp || 0),
        discount: Number(product?.discount || 0),
        afterDiscountPrice: Number(product?.afterDiscount || 0),
        stockLeft: Number(product?.stockLeft || 0),
        image: product?.images?.[0] || "",
        code: product?.code || "",
        units: product?.units || "",
        limit: product?.limit || "",
      };
    });

    CartStorage.upsertCategory(selectedCategory, current);
    setGrandSummary(CartStorage.grandSummary());
  }, [cart, selectedCategory, products]);

  useEffect(() => {
    if (!products.length) return;

    setCart((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [pid, qty] of Object.entries(prev)) {
        const product = products.find((p) => String(p.id) === String(pid));
        if (!product) continue;
        const clamped = clampQtyFor(product, qty);
        if (clamped !== qty) {
          if (clamped <= 0) delete next[pid];
          else next[pid] = clamped;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [products]);

  // const handleIncrement = (productId) =>
  //   setCart((prev) => {
  //     const product = products.find((p) => String(p.id) === String(productId));
  //     if (!product) return prev;
  //     const nextQty = clampQtyFor(product, (prev[productId] || 0) + 1);
  //     if (nextQty === prev[productId]) return prev;
  //     return { ...prev, [productId]: nextQty };
  //   });

  const handleAddClick = (id) => {
    const product = products.find((p) => String(p.id) === String(id));
    if (!product) return;
    const qty = clampQtyFor(product, 1);
    if (qty <= 0) return;
    setCart((prev) => ({ ...prev, [id]: qty }));
    setChecked(true);
  };

  // const getQty = (id) => Number(cart?.[id] || 0);
  // const canAddMore = (id) => {
  //   const product = products.find((p) => String(p.id) === String(id));
  //   if (!product) return false;
  //   const current = getQty(id);
  //   const maxAllowed = clampQtyFor(product, Infinity);
  //   return current < maxAllowed;
  // };

  const handleDecrementClick = (productId) =>
    setCart((prev) => {
      const next = (prev[productId] || 0) - 1;
      const copy = { ...prev };
      if (next <= 0) delete copy[productId];
      else copy[productId] = next;
      return copy;
    });

  useEffect(() => {
    localStorage.setItem("cartData", JSON.stringify(cart));
  }, [cart]);

  const toggleLike = (productId) => {
    setLikedProducts((prev) => ({
      ...prev,
      [productId]: !prev[productId],
    }));
  };

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // const handleImageClick = (imageSrc, product) => {
  //   setZoomImage(imageSrc);
  //   setZoomProduct(product);
  //   setShowZoomModal(true);
  // };

  function getItemTime(p) {
    if (p?.date) {
      const t = Date.parse(p.date);
      if (!Number.isNaN(t)) return t;
    }
    const candidates = [
      p.createdAt,
      p.created_on,
      p.createdDate,
      p.createDate,
      p.updatedAt,
      p.updated_on,
      p.modifiedAt,
      p.modified_on,
      p.addedDate,
      p.added_at,
      p.timestamp,
      p.timeStamp,
    ];
    for (const c of candidates) {
      const t = Date.parse(c);
      if (!Number.isNaN(t)) return t;
    }
    if (typeof p.id === "number") return p.id;
    const idNum = Number(String(p.id || "").replace(/\D/g, "")) || 0;
    return idNum;
  }

  useEffect(() => {
    if (!selectedCategory) return;
    let cancelled = false;
    const controller = new AbortController();

    const applyResolvedImage = ({ productId, dataUrl }) => {
      if (!productId || !dataUrl || cancelled) return;
      setImageUrls((prev) => {
        if (prev[productId]?.[0] === dataUrl) return prev;
        return { ...prev, [productId]: [dataUrl] };
      });
    };

    async function fetchProductsAndImages(signal) {
      try {
        setImageLoading(true);
        setImageUrls({});

        const url = `https://lmartapiv1-fxcyd2b4btacgsav.westus2-01.azurewebsites.net/api/UploadGrocery/GetGroceryItemsBycategory?Category=${encodeURIComponent(
          selectedCategory,
        )}`;
        const { data: items } = await axios.get(url, { signal });
        const safeItems = Array.isArray(items) ? items : [];
        if (cancelled) return;

        const selectedCategoryLower = String(selectedCategory).toLowerCase();
        const sortedOffers = [...safeItems]
          .filter(
            (item) =>
              String(item?.category || "").toLowerCase() === selectedCategoryLower &&
              item?.status === "Approved" &&
              Number(item?.discount) > 0,
          )
          .sort((a, b) => {
            const stockA = Number(a.stockLeft || 0);
            const stockB = Number(b.stockLeft || 0);
            if (stockA <= 0 && stockB > 0) return 1;
            if (stockA > 0 && stockB <= 0) return -1;
            const timeA = getItemTime(a);
            const timeB = getItemTime(b);
            if (timeA !== timeB) return timeB - timeA;
            return String(b.id).localeCompare(String(a.id));
          });

        setProducts(sortedOffers);
        setVisibleCount(Math.min(INITIAL_VISIBLE_PRODUCTS, sortedOffers.length || INITIAL_VISIBLE_PRODUCTS));
        setImageLoading(false);

        const imageQueue = sortedOffers
          .map((product) => ({
            productId: product.id,
            photo: Array.isArray(product.images) ? product.images[0] : null,
          }))
          .filter((item) => !!item.photo);

        const initialImages = imageQueue.slice(0, INITIAL_IMAGE_COUNT);
        const deferredImages = imageQueue.slice(INITIAL_IMAGE_COUNT);

        await hydrateOfferImages({
          items: initialImages,
          signal,
          concurrency: IMAGE_FETCH_CONCURRENCY,
          onResolved: applyResolvedImage,
        });

        if (!cancelled && deferredImages.length) {
          void hydrateOfferImages({
            items: deferredImages,
            signal,
            concurrency: IMAGE_FETCH_CONCURRENCY,
            onResolved: applyResolvedImage,
          });
        }
      } catch (err) {
        if (err?.name !== "CanceledError" && err?.name !== "AbortError") {
          console.error("Error fetching grocery products:", err);
          if (!cancelled) {
            setProducts([]);
            setImageUrls({});
            setImageLoading(false);
          }
        }
      }
    }

    fetchProductsAndImages(controller.signal);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedCategory]);

  useEffect(() => {
    let savedCategories = [];
    try {
      const raw = localStorage.getItem("allCategories");
      if (raw) {
        const parsed = JSON.parse(raw);
        savedCategories = Array.isArray(parsed) ? parsed : [parsed];
      }
    } catch (e) {
      console.error("Invalid JSON in localStorage for allCategories:", e);
    }

    const currentCategory = decodeURIComponent(encodedCategory);
    const existingCategory = savedCategories.find(
      (c) => c.categoryName === currentCategory,
    );
    if (existingCategory) {
      const restoredCart = {};
      (existingCategory.products || []).forEach((p) => {
        restoredCart[p.productId] = p.qty;
      });
      setCart(restoredCart);
    }
  }, [encodedCategory]);

  const filteredProducts = products.filter(
    (p) =>
      p.category?.toLowerCase() === selectedCategory.toLowerCase() &&
      p.status === "Approved" &&
      Number(p.discount) > 0 &&
      (searchQuery === "" ||
        p.name?.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  useEffect(() => {
    if (!filteredProducts.length) {
      setVisibleCount(INITIAL_VISIBLE_PRODUCTS);
      return undefined;
    }

    if (searchQuery.trim()) {
      setVisibleCount(filteredProducts.length);
      return undefined;
    }

    setVisibleCount((prev) => Math.max(Math.min(prev || INITIAL_VISIBLE_PRODUCTS, filteredProducts.length), Math.min(INITIAL_VISIBLE_PRODUCTS, filteredProducts.length)));

    if (visibleCount >= filteredProducts.length) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + PRODUCT_REVEAL_STEP, filteredProducts.length));
    }, PRODUCT_REVEAL_DELAY);

    return () => window.clearTimeout(timer);
  }, [filteredProducts.length, searchQuery, visibleCount]);

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const loadedImageCount = filteredProducts.reduce(
    (count, product) => count + (imageUrls[product.id]?.[0] ? 1 : 0),
    0,
  );
  const maxDiscount = filteredProducts.reduce(
    (max, product) => Math.max(max, Number(product.discount) || 0),
    0,
  );
  const savingsLabel = maxDiscount > 0 ? `Up to ${Math.round(maxDiscount)}% OFF` : "Fresh offers live now";

  return (
    <>
      <div>
        <div>
          <h1
            style={{
              background: "green",
              color: "white",
              fontFamily: "'Baloo 2'",
              fontSize: "25px",
              padding: "2px",
              fontWeight: "bold",
              textAlign: "center",
              width: "100%",
              boxShadow: "0 4px 15px rgba(0,0,0,0.2)",
              letterSpacing: "1px",
              marginBottom: "3px",
              position: "fixed",
              top: 0,
              left: 0,
              zIndex: 1000,
            }}
          >
            Lakshmi Mart
            <br />
            <span
              style={{
                fontSize: "12px",
                fontWeight: "bold",
                display: "block",
                marginTop: "2px",
                textAlign: "center",
                fontFamily: "Roboto",
              }}
            >
              FSSAI LIC Number - 20125051001066
            </span>
            <span
              style={{
                fontSize: "12px",
                fontWeight: "bold",
                display: "block",
                marginTop: "2px",
                textAlign: "center",
                fontFamily: "Roboto",
              }}
            >
              Delivery Timings : 07:00 AM -09:00 PM
            </span>
          </h1>
        </div>

        <div
          className="wrapper d-flex"
          style={{ marginTop: isMobile ? "65px" : "170px" }}
        >
          {!isMobile ? (
            <div className="ml-0 p-0 sde_mnu">
              <Sidebar userType={selectedUserType} />
            </div>
          ) : (
            <div className="groceryfloating-menu">
              <Button
                variant="primary"
                className="rounded-circle shadow"
                onClick={() => setShowMenu(!showMenu)}
              >
                <MoreVertIcon />
              </Button>
              {showMenu && (
                <div className="sidebar-container">
                  <Sidebar userType={selectedUserType} />
                </div>
              )}
            </div>
          )}

          <div className={`container ${isMobile ? "w-100" : "w-75"} `}>
            <div
              style={{
                position: "fixed",
                top: "65px",
                left: 0,
                width: "100%",
                background: "white",
                zIndex: 999,
                padding: "8px 12px",
                boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
              }}
            >
              <div className="position-relative flex-grow-1 ms-5">
                <input
                  type="text"
                  className="form-control w-60 mt-2 ps-5 "
                  placeholder="Search Products"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value.trimStart())}
                />
                <SearchIcon
                  className="position-absolute top-50 start-0 translate-middle-y ms-3 text-muted"
                  style={{ pointerEvents: "none" }}
                />
              </div>

              {selectedCategory && (
                <>
                  <div className="d-flex align-items-center">
                    <ArrowBackIcon
                      className="me-2"
                      style={{ color: "green", cursor: "pointer" }}
                      onClick={() =>
                        navigate(`/profilePage/${userType}/${userId}`)
                      }
                    />
                    <h4 className="fw-bold mb-0">{selectedCategory}</h4>
                  </div>
                </>
              )}
            </div>

            {selectedCategory && (
              <>
                <div className="offer-feed-shell" style={{ marginTop: "90px" }}>
                  <div className="offer-hero-banner">
                    <div>
                      <div className="offer-hero-pill">Lightning deals</div>
                      <h3 className="offer-hero-title">{selectedCategory}</h3>
                      <p className="offer-hero-subtitle">
                        Fast deals feed with instant cards, quick image fill, and better shopping flow.
                      </p>
                    </div>
                    <div className="offer-hero-price">{savingsLabel}</div>
                  </div>

                  <div className="offer-stats-row">
                    <div className="offer-stat-chip">
                      <span className="offer-stat-label">Offers</span>
                      <span className="offer-stat-value">{filteredProducts.length}</span>
                    </div>
                    <div className="offer-stat-chip">
                      <span className="offer-stat-label">Loaded</span>
                      <span className="offer-stat-value">{loadedImageCount}/{filteredProducts.length || 0}</span>
                    </div>
                    <div className="offer-stat-chip">
                      <span className="offer-stat-label">Selected</span>
                      <span className="offer-stat-value">{Object.values(cart).reduce((sum, qty) => sum + qty, 0)}</span>
                    </div>
                    <div className="offer-stat-chip offer-stat-chip--price">
                      <span className="offer-stat-label">Total</span>
                      <span className="offer-stat-value">
                        ₹{Math.round(
                          Object.entries(cart).reduce((sum, [productId, qty]) => {
                            const product = products.find(
                              (p) => String(p.id) === String(productId),
                            );
                            return sum + (product ? Number(product.afterDiscount) * qty : 0);
                          }, 0),
                        )}
                      </span>
                    </div>
                  </div>

                  {!searchQuery.trim() && visibleCount < filteredProducts.length && (
                    <div className="offer-progress-hint">
                      Showing {visibleProducts.length} of {filteredProducts.length} deals while more cards stream in...
                    </div>
                  )}

                  <div
                    className="grocery-row flex flex-wrap gap-1"
                    style={{ marginBottom: "60px" }}
                  >
                    {imageLoading && !filteredProducts.length &&
                      Array.from({ length: OFFER_SKELETON_COUNT }).map((_, index) => (
                        <div key={`offer-skeleton-${index}`} className="offer-feed-card offer-feed-card--skeleton">
                          <div className="offer-feed-skeleton offer-feed-skeleton--badge banner-shimmer-bar" />
                          <div className="offer-feed-skeleton offer-feed-skeleton--image banner-shimmer-bar" />
                          <div className="offer-feed-skeleton offer-feed-skeleton--line banner-shimmer-bar" />
                          <div className="offer-feed-skeleton offer-feed-skeleton--line-short banner-shimmer-bar" />
                          <div className="offer-feed-skeleton offer-feed-skeleton--price banner-shimmer-bar" />
                          <div className="offer-feed-skeleton offer-feed-skeleton--cta banner-shimmer-bar" />
                        </div>
                      ))}

                    {!imageLoading && !filteredProducts.length && (
                      <div className="offer-empty-state">
                        No offers matched your search right now.
                      </div>
                    )}

                    {visibleProducts.map((product, index) => {
                      const stock = Number(product.stockLeft || 0);
                      const isOutOfStock = stock <= 0;

                      return (
                        <div
                          key={product.id}
                          className="offer-feed-card"
                          style={{
                            minHeight: "258px",
                            opacity: isOutOfStock ? 0.6 : 1,
                            animationDelay: `${Math.min(index * 45, 280)}ms`,
                          }}
                        >
                          <div className="offer-feed-card-top">
                            {Number(product.discount) > 0 && !isOutOfStock && (
                              <span className="offer-feed-discount-badge">
                                {Math.round(Number(product.discount))}% OFF
                              </span>
                            )}

                            {!isOutOfStock && (
                              <span
                                className="offer-feed-like"
                                onClick={() => toggleLike(product.id)}
                              >
                                {likedProducts[product.id] ? (
                                  <FavoriteIcon style={{ color: "red" }} />
                                ) : (
                                  <FavoriteBorderIcon style={{ color: "grey" }} />
                                )}
                              </span>
                            )}
                          </div>

                          <div className="offer-feed-image-wrap">
                            {!imageUrls[product.id]?.[0] ? (
                              <div className="category-image-rocket-loader offer-feed-loader-shell">
                                <div className="category-image-rocket-glow" />
                                <div className="category-image-rocket-trail" />
                                <div className="category-image-rocket-body" />
                                <div className="category-image-rocket-window" />
                                <div className="category-image-rocket-fin category-image-rocket-fin-left" />
                                <div className="category-image-rocket-fin category-image-rocket-fin-right" />
                                <div className="category-image-rocket-flame" />
                                <div className="category-image-rocket-smoke category-image-rocket-smoke-one" />
                                <div className="category-image-rocket-smoke category-image-rocket-smoke-two" />
                              </div>
                            ) : (
                              <img
                                src={imageUrls[product.id][0]}
                                alt={product.name}
                                loading={index < 4 ? "eager" : "lazy"}
                                fetchPriority={index < 2 ? "high" : "auto"}
                                decoding="async"
                                width="160"
                                height="160"
                                className="category-product-image is-visible offer-feed-image"
                                style={{
                                  cursor: isOutOfStock ? "not-allowed" : "pointer",
                                }}
                                onClick={() => {
                                  if (isOutOfStock) return;
                                  navigate(
                                    `/groceryComboOffer/${userType}/${userId}/${product.id}`,
                                    {
                                      state: {
                                        product,
                                        imageUrl: imageUrls[product.id]?.[0] ?? null,
                                      },
                                    },
                                  );
                                }}
                              />
                            )}

                            {isOutOfStock && (
                              <div className="offer-feed-stock-mask">
                                <span className="offer-feed-stock-pill">Out of Stock</span>
                              </div>
                            )}
                          </div>

                          <h6 className="offer-feed-title">{product.name}</h6>

                          {!isOutOfStock && (
                            <div className="offer-feed-meta">
                              <div className="offer-feed-price-row">
                                {product.afterDiscount != null && (
                                  <b className="offer-feed-price-current">
                                    ₹{Math.round(Number(product.afterDiscount))}
                                  </b>
                                )}
                                {product.mrp != null && (
                                  <s className="offer-feed-price-mrp">₹{product.mrp}</s>
                                )}
                                {product.units && (
                                  <b className="offer-feed-units">{product.units}</b>
                                )}
                              </div>

                              {(() => {
                                const limit = getLimit(product);
                                return Number.isFinite(limit) && limit > 0 ? (
                                  <div className="offer-feed-limit">Max {limit} per customer</div>
                                ) : null;
                              })()}
                            </div>
                          )}

                          {!isOutOfStock && (
                            <div className="offer-feed-actions">
                              <label className="offer-feed-check">
                                <input
                                  type="checkbox"
                                  className="border-dark"
                                  checked={cart[product.id] > 0}
                                  onChange={() => {
                                    if (cart[product.id] > 0) {
                                      handleDecrementClick(product.id);
                                    } else {
                                      handleAddClick(product.id);
                                    }
                                  }}
                                />
                                <span>Select</span>
                              </label>

                              <button
                                className="offer-feed-add-btn"
                                onClick={() => {
                                  handleAddClick(product.id);
                                  navigate(`/groceryComboOffer/${userType}/${userId}/${product.id}`, {
                                    state: {
                                      product,
                                      imageUrl: imageUrls[product.id]?.[0] ?? null,
                                    },
                                  });
                                }}
                              >
                                ADD
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Cart Bar */}
                  {/* {(() => {
                    const readAllCategories = () => {
                      if (typeof window === "undefined") return [];
                      try {
                        const raw = localStorage.getItem("allCategories");
                        if (!raw) return [];
                        const parsed = JSON.parse(raw);
                        const arr = Array.isArray(parsed) ? parsed : [parsed];
                        return arr.filter(Boolean).map((cat) => ({
                          ...cat,
                          products: Array.isArray(cat?.products)
                            ? cat.products
                            : [],
                        }));
                      } catch (e) {
                        console.error("Invalid JSON in allCategories:", e);
                        return [];
                      }
                    };

                    const allCategories = readAllCategories();
                    const summary = allCategories.reduce(
                      (acc, cat) => {
                        for (const p of cat.products) {
                          const qty = Number(p?.qty) || 0;
                          if (!qty) continue;
                          const price =
                            Number(
                              p?.afterDiscountPrice ??
                                p?.price ??
                                p?.finalPrice ??
                                0,
                            ) || 0;
                          acc.items += qty;
                          acc.total += price * qty;
                        }
                        return acc;
                      },
                      { items: 0, total: 0 },
                    );

                    const items = summary.items;
                    const total = Math.round(summary.total);

                    return items > 0 ? (
                      <div
                        style={{
                          position: "fixed",
                          bottom: "0px",
                          left: 0,
                          width: "100%",
                          backgroundColor: "green",
                          color: "white",
                          padding: "6px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontWeight: "bold",
                          zIndex: 2000,
                          borderRadius: "20px",
                          marginTop: "3px",
                          marginBottom: "5px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                          }}
                        >
                          🛒
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "10px",
                              }}
                            >
                              {items} items
                            </span>
                            <span
                              style={{
                                fontSize: "10px",
                              }}
                            >
                              ₹{total}
                            </span>
                            {total < MIN_ORDER_TOTAL && (
                              <span
                                style={{
                                  fontSize: "13px",
                                  opacity: 0.9,
                                  fontWeight: "bold",
                                }}
                              >
                                Add ₹{MIN_ORDER_TOTAL - total} more to reach
                                Minimum Order
                              </span>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="text-white fw-bold d-flex align-items-center gap-1"
                          style={{
                            fontSize: "12px",
                            cursor:
                              total < MIN_ORDER_TOTAL
                                ? "not-allowed"
                                : "pointer",
                            background: "transparent",
                            border: "none",
                            opacity: total < MIN_ORDER_TOTAL ? 0.7 : 1,
                          }}
                          onClick={() => {
                            if (total < MIN_ORDER_TOTAL) return;
                            navigate(
                              `/groceryCart/${userType}/${userId}`,
                              {
                                state: { mobileNumber },
                              },
                            );
                          }}
                        >
                          View Cart →
                        </button>
                      </div>
                    ) : null;
                  })()} */}
                </div>
              </>
            )}
          </div>
        </div>
        <Footer />
      </div>

      {/* <Modal
        show={showZoomModal}
        onHide={() => {
          setShowZoomModal(false);
          setZoomProduct(null);
        }}
        centered
      >
        <button
          className="close-button text-end mt-0"
          onClick={() => {
            setShowZoomModal(false);
            setZoomProduct(null);
          }}
        >
          &times;
        </button>
        <Modal.Body className="text-center">
          <div className="zoom-container">
            <img
              src={zoomImage}
              alt={zoomProduct?.name || "Zoomed Product"}
              className="zoom-image"
            />
          </div>
          <h6 className="text-start fw-bold m-0" style={{ fontSize: "12px" }}>
            {zoomProduct?.name || ""}
          </h6>
          {zoomProduct?.afterDiscount != null && (
            <p className="text-start m-0" style={{ fontSize: "12px" }}>
              <b className="text-success me-2">
                ₹{Math.round(Number(zoomProduct.afterDiscount))}
              </b>
              {zoomProduct?.mrp ? (
                <s className="text-muted">₹{zoomProduct.mrp}</s>
              ) : null}
            </p>
          )}
        </Modal.Body>
      </Modal> */}
    </>
  );
};

export default GroceryOfferItems;
