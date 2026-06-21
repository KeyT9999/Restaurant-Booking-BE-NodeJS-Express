'use strict';

const waitlistService = require('../services/waitlist.service');
const waitlistNotifications = require('../services/waitlist-notification.service');

const handleError = (res, error, fallbackMessage) => {
  console.error(`[OwnerWaitlist] ${error.message}`);
  return res.status(error.status || 500).json({
    success: false,
    message: error.message || fallbackMessage,
    errors: error.errors,
  });
};

const getWaitlists = async (req, res) => {
  try {
    const data = await waitlistService.getOwnerWaitlists(req.user._id, req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Khong the tai danh sach cho');
  }
};

const getStats = async (req, res) => {
  try {
    const data = await waitlistService.getOwnerStats(req.user._id, req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Khong the tai thong ke danh sach cho');
  }
};

const getWaitlistById = async (req, res) => {
  try {
    const waitlist = await waitlistService.getOwnerWaitlistDetail(req.user._id, req.params.id);
    return res.json({ success: true, data: { waitlist } });
  } catch (error) {
    return handleError(res, error, 'Khong the tai chi tiet danh sach cho');
  }
};

const getAvailableTables = async (req, res) => {
  try {
    const tables = await waitlistService.getAvailableTablesForWaitlist(req.user._id, req.params.id);
    return res.json({ success: true, data: { tables } });
  } catch (error) {
    return handleError(res, error, 'Khong the tai danh sach ban trong');
  }
};

const assignTables = async (req, res) => {
  try {
    const waitlist = await waitlistService.assignTables(req.user._id, req.params.id, req.body.tableIds || []);
    waitlistNotifications.notifyWaitlistUpdated(req.app.get('io'), waitlist, 'tables_assigned')
      .catch((err) => console.error('[OwnerWaitlist] notifyWaitlistUpdated failed:', err.message));

    return res.json({
      success: true,
      message: 'Gan ban cho danh sach cho thanh cong',
      data: { waitlist },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the gan ban');
  }
};

const confirmWaitlist = async (req, res) => {
  try {
    const data = await waitlistService.confirmWaitlist(
      req.user._id,
      req.params.id,
      req.body.tableIds || [],
      req.body.ownerNote
    );
    waitlistNotifications.notifyWaitlistConfirmed(req.app.get('io'), data.waitlist, data.booking)
      .catch((err) => console.error('[OwnerWaitlist] notifyWaitlistConfirmed failed:', err.message));

    return res.json({
      success: true,
      message: 'Xac nhan danh sach cho va tao booking thanh cong',
      data,
    });
  } catch (error) {
    return handleError(res, error, 'Khong the xac nhan danh sach cho');
  }
};

const cancelWaitlist = async (req, res) => {
  try {
    const waitlist = await waitlistService.cancelOwnerWaitlist(
      req.user._id,
      req.params.id,
      req.body.reason
    );
    waitlistNotifications.notifyWaitlistCancelled(req.app.get('io'), waitlist)
      .catch((err) => console.error('[OwnerWaitlist] notifyWaitlistCancelled failed:', err.message));

    return res.json({
      success: true,
      message: 'Huy danh sach cho thanh cong',
      data: { waitlist },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the huy danh sach cho');
  }
};

const expireWaitlist = async (req, res) => {
  try {
    const waitlist = await waitlistService.expireOwnerWaitlist(
      req.user._id,
      req.params.id,
      req.body.reason
    );
    waitlistNotifications.notifyWaitlistExpired(req.app.get('io'), waitlist)
      .catch((err) => console.error('[OwnerWaitlist] notifyWaitlistExpired failed:', err.message));

    return res.json({
      success: true,
      message: 'Da danh dau danh sach cho het han',
      data: { waitlist },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the danh dau het han');
  }
};

const updatePriority = async (req, res) => {
  try {
    const waitlist = await waitlistService.updatePriority(
      req.user._id,
      req.params.id,
      req.body.priorityNumber,
      req.body.reason
    );
    waitlistNotifications.notifyWaitlistUpdated(req.app.get('io'), waitlist, 'priority_updated')
      .catch((err) => console.error('[OwnerWaitlist] notifyWaitlistUpdated failed:', err.message));

    return res.json({
      success: true,
      message: 'Cap nhat uu tien thanh cong',
      data: { waitlist },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the cap nhat uu tien');
  }
};

const addInternalNote = async (req, res) => {
  try {
    const waitlist = await waitlistService.addInternalNote(req.user._id, req.params.id, req.body.content);
    return res.json({
      success: true,
      message: 'Them ghi chu noi bo thanh cong',
      data: { waitlist },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the them ghi chu');
  }
};

const deleteInternalNote = async (req, res) => {
  try {
    const waitlist = await waitlistService.deleteInternalNote(
      req.user._id,
      req.params.id,
      req.params.noteId
    );
    return res.json({
      success: true,
      message: 'Xoa ghi chu noi bo thanh cong',
      data: { waitlist },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the xoa ghi chu');
  }
};

module.exports = {
  getWaitlists,
  getStats,
  getWaitlistById,
  getAvailableTables,
  assignTables,
  confirmWaitlist,
  cancelWaitlist,
  expireWaitlist,
  updatePriority,
  addInternalNote,
  deleteInternalNote,
};
