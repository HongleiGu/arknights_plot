package com.arknights.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;

import com.arknights.pojo.User;

@Mapper
public interface AccountMapper {
  public List<User> login(User user);

  public void register (User user);

  public Integer findUsername(String username);
}
