const Chemical = require("../models/Chemical");

// GET /api/chemicals
// Query params: search, category, state, page, limit
const getChemicals = async (req, res, next) => {
  try {
    const { search, category, state, page = 1, limit = 50 } = req.query;
    const filter = { isActive: true };

    if (category) filter.category = category;
    if (state) filter.state = state;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { symbol: { $regex: search, $options: "i" } },
        { formula: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [chemicals, total] = await Promise.all([
      Chemical.find(filter).sort({ category: 1, name: 1 }).skip(skip).limit(parseInt(limit)).lean(),
      Chemical.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: chemicals,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/chemicals/:id
const getChemicalById = async (req, res, next) => {
  try {
    const chemical = await Chemical.findById(req.params.id).lean();
    if (!chemical) return res.status(404).json({ success: false, message: "Chemical not found." });
    res.status(200).json({ success: true, data: chemical });
  } catch (error) {
    next(error);
  }
};

module.exports = { getChemicals, getChemicalById };
